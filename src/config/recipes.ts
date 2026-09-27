import type { MaterialTag } from "./materials";

/**
 * 配方图鉴的确定性规则表：
 * 素材的类型标签组合（不含 rare，rare 只作为"稀有增幅"标记）决定结果的类型和大方向，
 * 具体数值由 craftingEngine 在这里给出的区间内做随机浮动。
 *
 * key 的构造规则见 craftingEngine.buildRecipeKey：
 * - 单一主导标签 -> "fire" / "ice" / "explosive" / "poison"
 * - 两个主导标签 -> 按字母序 join，如 "explosive+fire"
 */

export type EffectKind = "burn" | "slow" | "poison" | "shock" | "stun" | "none";

export interface RecipeRule {
  key: string;
  resultName: string;
  /** 是否为范围溅射弹药（影响炮塔攻击方式） */
  isAoe: boolean;
  /** 附加特效类型（灼烧/减速/中毒/触电），用于战斗计算和视觉呈现 */
  effect: EffectKind;
  /** 渲染用主色（十六进制） */
  color: number;
  /** 相对于基础属性向量的伤害随机倍率区间 [min, max] */
  damageMultiplierRange: [number, number];
  /** 暴击率区间（百分比，0-100） */
  critChanceRange: [number, number];
  /** 描述，展示在图鉴中 */
  description: string;
}

export const RECIPE_RULES: RecipeRule[] = [
  {
    key: "physical",
    resultName: "破甲弹",
    isAoe: false,
    effect: "stun",
    color: 0xb8b8c8,
    damageMultiplierRange: [1.15, 1.5],
    critChanceRange: [5, 12],
    description: "物理系弹药，高伤害穿透护甲，命中后短暂击退/硬直目标（物理系独有的控制手段，不与法系的减速/中毒重叠）。",
  },
  {
    key: "fire",
    resultName: "火种弹",
    isAoe: false,
    effect: "burn",
    color: 0xff6a3d,
    damageMultiplierRange: [0.9, 1.2],
    critChanceRange: [5, 15],
    description: "单体火焰弹药，命中后附加短暂灼烧。",
  },
  {
    key: "ice",
    resultName: "寒冰弹",
    isAoe: false,
    effect: "slow",
    color: 0x63c9ff,
    damageMultiplierRange: [0.8, 1.05],
    critChanceRange: [5, 12],
    description: "单体冰霜弹药，命中后减速目标。",
  },
  {
    key: "explosive",
    resultName: "爆裂弹",
    isAoe: true,
    effect: "none",
    color: 0xffb545,
    damageMultiplierRange: [1.1, 1.5],
    critChanceRange: [3, 10],
    description: "范围爆炸弹药，对命中点周围造成溅射伤害。",
  },
  {
    key: "poison",
    resultName: "腐毒弹",
    isAoe: false,
    effect: "poison",
    color: 0x7cff6a,
    damageMultiplierRange: [0.7, 1.0],
    critChanceRange: [5, 10],
    description: "单体毒素弹药，命中后造成持续中毒伤害。",
  },
  {
    key: "explosive+fire",
    resultName: "燃烧弹",
    isAoe: true,
    effect: "burn",
    color: 0xff3d1f,
    damageMultiplierRange: [1.2, 1.7],
    critChanceRange: [8, 20],
    description: "AOE燃烧弹，爆炸范围内的敌人持续灼烧。",
  },
  {
    key: "explosive+ice",
    resultName: "冰爆弹",
    isAoe: true,
    effect: "slow",
    color: 0x8fd8ff,
    damageMultiplierRange: [1.05, 1.4],
    critChanceRange: [5, 14],
    description: "AOE冰霜爆炸弹，范围内敌人被大幅减速。",
  },
  {
    key: "explosive+poison",
    resultName: "瘟疫弹",
    isAoe: true,
    effect: "poison",
    color: 0x8fff45,
    damageMultiplierRange: [0.95, 1.3],
    critChanceRange: [6, 16],
    description: "AOE瘟疫爆炸弹，范围内敌人持续中毒。",
  },
  {
    key: "fire+ice",
    resultName: "冷热冲击弹",
    isAoe: false,
    effect: "shock",
    color: 0xc86aff,
    damageMultiplierRange: [1.0, 1.35],
    critChanceRange: [15, 30],
    description: "冷热交替造成的冲击弹药，高暴击率。",
  },
  {
    key: "fire+poison",
    resultName: "腐蚀烈焰弹",
    isAoe: false,
    effect: "burn",
    color: 0xd6541f,
    damageMultiplierRange: [1.0, 1.3],
    critChanceRange: [8, 18],
    description: "融合灼烧与中毒的单体弹药。",
  },
  {
    key: "ice+poison",
    resultName: "冻毒弹",
    isAoe: false,
    effect: "slow",
    color: 0x6adfae,
    damageMultiplierRange: [0.85, 1.1],
    critChanceRange: [6, 14],
    description: "融合减速与中毒的单体弹药。",
  },
];

export function findRecipeRule(key: string): RecipeRule | undefined {
  return RECIPE_RULES.find((r) => r.key === key);
}

/** 用于图鉴 UI：所有可能的标签组合数（不含 rare 自身） */
export const CRAFTABLE_TAGS: MaterialTag[] = ["fire", "ice", "explosive", "poison"];
