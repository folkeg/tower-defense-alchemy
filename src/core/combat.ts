import type { EnemyDef } from "../config/enemies";
import type { TowerDef } from "../config/towers";
import type { Point } from "../config/map";
import type { AmmoInstance } from "./ammo";
import type { Rng } from "./craftingEngine";
import type { EffectKind } from "../config/recipes";

// ---------------------------------------------------------------------------
// 敌人运行时状态与路径移动
// ---------------------------------------------------------------------------

export interface StatusEffectState {
  kind: "burn" | "poison" | "slow";
  /** 每秒伤害（仅 burn/poison 生效） */
  dps: number;
  /** 减速系数 0-1，代表降低的速度比例（仅 slow 生效） */
  slowFactor: number;
  remainingSeconds: number;
}

let nextEnemyId = 1;
export function resetEnemyIdCounter(): void {
  nextEnemyId = 1;
}

export class EnemyInstance {
  readonly id: number;
  readonly def: EnemyDef;
  hp: number;
  /** 当前所在折线段索引 */
  segmentIndex = 0;
  /** 沿路径已经走过的总距离（像素） */
  distanceTraveled = 0;
  position: Point;
  effects: StatusEffectState[] = [];
  reachedEnd = false;

  constructor(def: EnemyDef, path: Point[]) {
    this.id = nextEnemyId++;
    this.def = def;
    this.hp = def.hp;
    this.position = { ...path[0] };
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  /** 当前有效移动速度（受减速效果叠加影响，取最强减速） */
  getEffectiveSpeed(): number {
    const slow = this.effects.filter((e) => e.kind === "slow");
    if (slow.length === 0) return this.def.speed;
    const strongest = Math.max(...slow.map((e) => e.slowFactor));
    return this.def.speed * (1 - strongest);
  }
}

export function pathTotalLength(path: Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distance(path[i - 1], path[i]);
  }
  return total;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 沿折线路径推进敌人位置，返回是否已到达终点 */
export function advanceEnemyAlongPath(
  enemy: EnemyInstance,
  path: Point[],
  deltaSeconds: number,
): void {
  if (enemy.reachedEnd || !enemy.isAlive()) return;
  let remainingMove = enemy.getEffectiveSpeed() * deltaSeconds;

  while (remainingMove > 0) {
    if (enemy.segmentIndex >= path.length - 1) {
      enemy.reachedEnd = true;
      enemy.position = { ...path[path.length - 1] };
      return;
    }
    const start = path[enemy.segmentIndex];
    const end = path[enemy.segmentIndex + 1];
    const segLen = distance(start, end);
    const traveledInSegment = distance(start, enemy.position);
    const remainingInSegment = segLen - traveledInSegment;

    if (remainingMove < remainingInSegment) {
      const t = (traveledInSegment + remainingMove) / segLen;
      enemy.position = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
      enemy.distanceTraveled += remainingMove;
      remainingMove = 0;
    } else {
      enemy.distanceTraveled += remainingInSegment;
      remainingMove -= remainingInSegment;
      enemy.segmentIndex += 1;
      enemy.position = { ...end };
    }
  }
}

/** 每帧结算状态效果的持续伤害与计时衰减 */
export function tickEnemyEffects(enemy: EnemyInstance, deltaSeconds: number): void {
  for (const effect of enemy.effects) {
    if (effect.kind === "burn" || effect.kind === "poison") {
      enemy.hp -= effect.dps * deltaSeconds;
    }
    effect.remainingSeconds -= deltaSeconds;
  }
  enemy.effects = enemy.effects.filter((e) => e.remainingSeconds > 0);
  if (enemy.hp < 0) enemy.hp = 0;
}

const EFFECT_DURATION: Record<Exclude<EffectKind, "none" | "shock">, number> = {
  burn: 3,
  poison: 4,
  slow: 2,
};

/** 根据弹药特效类型，为目标敌人施加对应的状态效果（shock/none 不产生持续效果） */
export function applyAmmoEffect(
  enemy: EnemyInstance,
  effect: EffectKind,
  finalDamage: number,
  potency: number,
): void {
  if (effect === "burn" || effect === "poison") {
    enemy.effects.push({
      kind: effect,
      dps: finalDamage * 0.15 * (0.5 + potency),
      slowFactor: 0,
      remainingSeconds: EFFECT_DURATION[effect],
    });
  } else if (effect === "slow") {
    enemy.effects.push({
      kind: "slow",
      dps: 0,
      slowFactor: Math.min(0.75, 0.2 + potency * 0.4),
      remainingSeconds: EFFECT_DURATION.slow,
    });
  }
  // "shock"/"none" 不附加额外的持续状态，其收益已体现在暴击率上
}

// ---------------------------------------------------------------------------
// 炮塔运行时状态与开火逻辑
// ---------------------------------------------------------------------------

export interface FireOutcome {
  targetId: number;
  damageDealt: number;
  isCrit: boolean;
  splashHits: { targetId: number; damageDealt: number }[];
}

let nextTowerId = 1;
export function resetTowerIdCounter(): void {
  nextTowerId = 1;
}

export class TowerInstance {
  readonly id: number;
  readonly def: TowerDef;
  position: Point;
  loadedAmmo: AmmoInstance | null = null;
  /** 是否曾经装填过弹药（用于区分"从未装填的裸塔"与"弹药耗尽后掉级回默认弹药"两种视觉状态） */
  everLoadedAmmo = false;
  cooldownRemaining = 0;

  constructor(def: TowerDef, position: Point) {
    this.id = nextTowerId++;
    this.def = def;
    this.position = position;
  }

  getEffectiveRange(): number {
    return this.def.baseRange + (this.loadedAmmo?.craftResult.finalRangeBonus ?? 0);
  }

  getEffectiveInterval(): number {
    const bonus = this.loadedAmmo?.craftResult.finalRateBonus ?? 0;
    return Math.max(0.15, this.def.baseAttackInterval - bonus);
  }

  canFire(): boolean {
    return this.cooldownRemaining <= 0;
  }

  tickCooldown(deltaSeconds: number): void {
    if (this.cooldownRemaining > 0) this.cooldownRemaining -= deltaSeconds;
  }
}

/** 索敌：在射程内选择路径进度最靠前（最接近终点）的敌人，是塔防的经典"最前方优先"策略 */
export function findTarget(tower: TowerInstance, enemies: EnemyInstance[]): EnemyInstance | null {
  const range = tower.getEffectiveRange();
  let best: EnemyInstance | null = null;
  for (const enemy of enemies) {
    if (!enemy.isAlive() || enemy.reachedEnd) continue;
    if (distance(tower.position, enemy.position) > range) continue;
    if (!best || enemy.distanceTraveled > best.distanceTraveled) {
      best = enemy;
    }
  }
  return best;
}

/**
 * 执行一次开火：对目标造成伤害（含暴击与护甲减免），如果弹药是 AOE 类型则对
 * 命中点周围的其他敌人也造成溅射伤害；消耗弹药一次射击次数并重置塔的冷却。
 */
export function fireTower(
  tower: TowerInstance,
  target: EnemyInstance,
  allEnemies: EnemyInstance[],
  rng: Rng = Math.random,
): FireOutcome | null {
  if (!tower.canFire()) return null;

  const ammo = tower.loadedAmmo;
  const baseDamage = ammo?.craftResult.finalDamage ?? tower.def.baseDamage;
  const critChance = ammo?.craftResult.finalCritChance ?? 0;
  const isCrit = rng() * 100 < critChance;
  const rawDamage = isCrit ? baseDamage * 2 : baseDamage;

  const dealtToTarget = applyDamageToEnemy(target, rawDamage);
  if (ammo) {
    applyAmmoEffect(target, ammo.craftResult.effect, rawDamage, ammo.craftResult.vector.potency);
  }

  const splashHits: { targetId: number; damageDealt: number }[] = [];
  const isAoe = ammo?.craftResult.isAoe ?? tower.def.splashRadius > 0;
  const splashRadius = tower.def.splashRadius > 0 ? tower.def.splashRadius : 60;
  if (isAoe) {
    for (const other of allEnemies) {
      if (other.id === target.id || !other.isAlive() || other.reachedEnd) continue;
      if (distance(target.position, other.position) <= splashRadius) {
        const splashDamage = rawDamage * 0.6;
        const dealt = applyDamageToEnemy(other, splashDamage);
        if (ammo) {
          applyAmmoEffect(other, ammo.craftResult.effect, splashDamage, ammo.craftResult.vector.potency);
        }
        splashHits.push({ targetId: other.id, damageDealt: dealt });
      }
    }
  }

  ammo?.registerShot();
  tower.cooldownRemaining = tower.getEffectiveInterval();

  return { targetId: target.id, damageDealt: dealtToTarget, isCrit, splashHits };
}

function applyDamageToEnemy(enemy: EnemyInstance, rawDamage: number): number {
  const mitigated = rawDamage * (1 - enemy.def.armor);
  const dealt = Math.min(enemy.hp, mitigated);
  enemy.hp -= mitigated;
  if (enemy.hp < 0) enemy.hp = 0;
  return dealt;
}
