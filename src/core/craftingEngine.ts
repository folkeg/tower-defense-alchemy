import type { MaterialDef, MaterialTag } from "../config/materials";
import { RECIPE_RULES, findRecipeRule, type EffectKind, type RecipeRule } from "../config/recipes";

/** 简单可复现的伪随机数生成器（mulberry32），便于单元测试注入固定种子 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export type AmmoTier = "temporary" | "permanent";

export type OutcomeTier = "great_failure" | "normal" | "great_success";

export interface AggregatedVector {
  damage: number;
  rate: number;
  range: number;
  potency: number;
}

export interface CraftPrediction {
  recipeKey: string;
  resultName: string;
  isAoe: boolean;
  effect: EffectKind;
  color: number;
  /** 预测伤害区间（含大成功/大失败边界），用于合成前 UI 展示 */
  predictedDamageRange: [number, number];
  /** 预测暴击率区间（百分比） */
  predictedCritRange: [number, number];
  greatSuccessChance: number;
  greatFailureChance: number;
  hasRare: boolean;
  vector: AggregatedVector;
  description: string;
}

export interface CraftResult extends CraftPrediction {
  ammoTier: AmmoTier;
  outcomeTier: OutcomeTier;
  finalDamage: number;
  finalCritChance: number;
  finalRangeBonus: number;
  finalRateBonus: number;
  materialIds: string[];
}

export const MIN_MATERIALS_PER_CRAFT = 2;
export const MAX_MATERIALS_PER_CRAFT = 4;

export class CraftingValidationError extends Error {}

/**
 * 由素材类型标签组合构造配方 key。
 * rare 标签不参与类型判定（只作为稀有增幅标记），
 * 取出现次数最多的最多两个非稀有标签，按字母序拼接。
 */
export function buildRecipeKey(materials: MaterialDef[]): { key: string; hasRare: boolean } {
  const counts = new Map<MaterialTag, number>();
  let hasRare = false;
  for (const m of materials) {
    if (m.tag === "rare") {
      hasRare = true;
      continue;
    }
    counts.set(m.tag, (counts.get(m.tag) ?? 0) + 1);
  }

  if (counts.size === 0) {
    throw new CraftingValidationError("至少需要一种非稀有素材来决定弹药类型");
  }

  const sortedTags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);

  const topTags = sortedTags.slice(0, 2).sort();
  const key = topTags.join("+");
  return { key, hasRare };
}

export function resolveRecipe(materials: MaterialDef[]): { rule: RecipeRule; hasRare: boolean } {
  const { key, hasRare } = buildRecipeKey(materials);
  let rule = findRecipeRule(key);
  if (!rule) {
    // 回退：只用出现次数最多的单一标签查规则，保证任意组合都有确定性结果
    const singleTag = key.split("+")[0];
    rule = findRecipeRule(singleTag);
  }
  if (!rule) {
    throw new CraftingValidationError(`无法解析配方: ${key}`);
  }
  return { rule, hasRare };
}

export function aggregateVector(materials: MaterialDef[]): AggregatedVector {
  const sum = materials.reduce(
    (acc, m) => ({
      damage: acc.damage + m.vector.damage,
      rate: acc.rate + m.vector.rate,
      range: acc.range + m.vector.range,
      potency: acc.potency + m.vector.potency,
    }),
    { damage: 0, rate: 0, range: 0, potency: 0 },
  );
  return {
    damage: sum.damage,
    rate: sum.rate,
    range: sum.range,
    potency: Math.min(1, sum.potency / materials.length),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function computeOutcomeChances(
  vector: AggregatedVector,
  hasRare: boolean,
): { greatSuccessChance: number; greatFailureChance: number } {
  const greatSuccessChance = clamp(8 + vector.potency * 20 + (hasRare ? 15 : 0), 5, 45);
  const greatFailureChance = clamp(10 - vector.potency * 6, 2, 10);
  return { greatSuccessChance, greatFailureChance };
}

function validateMaterials(materials: MaterialDef[]): void {
  if (materials.length < MIN_MATERIALS_PER_CRAFT || materials.length > MAX_MATERIALS_PER_CRAFT) {
    throw new CraftingValidationError(
      `合成需要 ${MIN_MATERIALS_PER_CRAFT}-${MAX_MATERIALS_PER_CRAFT} 个素材，当前为 ${materials.length}`,
    );
  }
}

/** 合成前的预测：不产生随机结果，只给出可能的区间供玩家评估风险 */
export function predictCraft(materials: MaterialDef[]): CraftPrediction {
  validateMaterials(materials);
  const { rule, hasRare } = resolveRecipe(materials);
  const vector = aggregateVector(materials);
  const { greatSuccessChance, greatFailureChance } = computeOutcomeChances(vector, hasRare);

  const [multMin, multMax] = rule.damageMultiplierRange;
  const rareBonus = hasRare ? 1.25 : 1;
  const worst = vector.damage * multMin * 0.75 * rareBonus;
  const best = vector.damage * multMax * 1.3 * rareBonus;

  const [critMin, critMax] = rule.critChanceRange;
  const predictedCritRange: [number, number] = [
    clamp(critMin - 5, 0, 100),
    clamp(critMax + 10, 0, 100),
  ];

  return {
    recipeKey: rule.key,
    resultName: rule.resultName,
    isAoe: rule.isAoe,
    effect: rule.effect,
    color: rule.color,
    predictedDamageRange: [Math.round(worst), Math.round(best)],
    predictedCritRange,
    greatSuccessChance,
    greatFailureChance,
    hasRare,
    vector,
    description: rule.description,
  };
}

/**
 * 执行实际合成，产生最终数值。
 * @param ammoTier "permanent" 需要至少一个稀有素材，效果打折但无时效限制
 */
export function craft(
  materials: MaterialDef[],
  ammoTier: AmmoTier,
  rng: Rng = Math.random,
): CraftResult {
  const prediction = predictCraft(materials);
  const { rule, hasRare } = resolveRecipe(materials);
  const vector = prediction.vector;

  if (ammoTier === "permanent" && !hasRare) {
    throw new CraftingValidationError("永久弹药至少需要一个稀有素材");
  }

  const roll = rng() * 100;
  let outcomeTier: OutcomeTier = "normal";
  if (roll < prediction.greatFailureChance) {
    outcomeTier = "great_failure";
  } else if (roll > 100 - prediction.greatSuccessChance) {
    outcomeTier = "great_success";
  }

  const [multMin, multMax] = rule.damageMultiplierRange;
  const multiplier = multMin + rng() * (multMax - multMin);
  const rareBonus = hasRare ? 1.25 : 1;

  let outcomeFactor = 1;
  let critAdjust = 0;
  if (outcomeTier === "great_failure") {
    outcomeFactor = 0.75;
    critAdjust = -5;
  } else if (outcomeTier === "great_success") {
    outcomeFactor = 1.3;
    critAdjust = 10;
  }

  let finalDamage = vector.damage * multiplier * rareBonus * outcomeFactor;

  const [critMin, critMax] = rule.critChanceRange;
  let finalCritChance = clamp(critMin + rng() * (critMax - critMin) + critAdjust, 0, 100);

  if (ammoTier === "permanent") {
    finalDamage *= 0.8;
  }

  return {
    ...prediction,
    ammoTier,
    outcomeTier,
    finalDamage: Math.round(finalDamage * 10) / 10,
    finalCritChance: Math.round(finalCritChance * 10) / 10,
    finalRangeBonus: Math.round(vector.range),
    finalRateBonus: Math.round(vector.rate * 100) / 100,
    materialIds: materials.map((m) => m.id),
  };
}

/** 图鉴：记录玩家已发现的配方 key 集合 */
export class RecipeJournal {
  private discovered = new Set<string>();

  record(recipeKey: string): void {
    this.discovered.add(recipeKey);
  }

  has(recipeKey: string): boolean {
    return this.discovered.has(recipeKey);
  }

  list(): string[] {
    return [...this.discovered];
  }

  /** 图鉴中所有已知配方规则（供 UI 遍历展示，未发现的可显示为"???"） */
  static allRules(): RecipeRule[] {
    return RECIPE_RULES;
  }
}
