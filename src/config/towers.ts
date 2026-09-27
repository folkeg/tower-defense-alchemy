/**
 * 设计原则（塔与弹药的分工，避免两个系统互相冗余）：
 *
 * 核心原则：塔决定"机制骨架"（怎么打），弹药决定"内容强度"（打出什么效果），两者是相乘关系，不能重叠。
 *
 * - 塔（Tower）负责：攻击的物理形式（单体高频/范围溅射/连锁跳跃/持续光束等）、
 *   基础攻速/射程/造价、弹药槽数量与倍率加成、花钱购买和升级
 *   （升级应强化数值和槽位，不应该决定伤害类型或元素属性——那是弹药该管的）。
 * - 弹药（Ammo）负责：伤害的元素属性（火/冰/毒/物理）、附加特效（灼烧DOT/减速/连锁感染等）、
 *   具体数值区间（伤害/暴击率）。
 *
 * 关键技巧：同一种弹药装在不同塔上，因为塔的机制不同，实际效果应该不同
 * （比如"燃烧弹药"装在单体塔上是"命中目标持续燃烧"，装在溅射塔上是"命中点范围内持续燃烧"），
 * 让塔和弹药形成"相乘"而非简单相加的策略深度。
 *
 * 后续扩展塔类型可参考的分工方向（当前 MVP 未全部实现）：
 * - 速射塔：攻速快单体，2槽，适合限时消耗型弹药
 * - 重炮塔：攻速慢单发伤害大，1槽但加成倍率高，适合稀有/永久弹药
 * - 溅射塔：范围伤害，弹药的AOE/DOT特效价值最大化
 * - 连锁塔：命中跳跃到附近敌人，适合减速/感染类特效弹药
 *
 * 塔的地形/位置策略（拐角覆盖、路径规划等）应完整保留，不要被弹药系统覆盖掉。
 * 详见 README.md「设计理念：炮塔与弹药系统分工」章节。
 */
export type TowerKind = "melee" | "splash";

export interface TowerDef {
  kind: TowerKind;
  name: string;
  /** 建造花费金币 */
  cost: number;
  /** 无弹药时的基础攻击范围（像素） */
  baseRange: number;
  /** 无弹药时的基础攻击间隔（秒） */
  baseAttackInterval: number;
  /** 无弹药时的基础伤害（弹药装填后由弹药属性叠加/覆盖） */
  baseDamage: number;
  /** 范围溅射半径（仅 splash 塔型，实际以弹药 isAoe 为准） */
  splashRadius: number;
  description: string;
  color: number;
}

export const TOWERS: Record<TowerKind, TowerDef> = {
  melee: {
    kind: "melee",
    name: "近程速射塔",
    cost: 40,
    // 注：该值需要覆盖 map.ts 中所有 TOWER_SLOTS 到 ENEMY_PATH 的最大最近距离
    // （目前实测最远格约 120px），否则会出现"塔建在某些格子上几乎打不到任何敌人"的死区 bug，
    // 见 2026-09 复盘：110px 曾与 1 号格恰好相切、8 号格完全超出射程，导致弹药消耗却零击杀。
    baseRange: 135,
    baseAttackInterval: 0.6,
    baseDamage: 8,
    splashRadius: 0,
    description: "单体目标，攻速快，适合搭配单体弹药清理落单敌人。",
    color: 0x5a7dff,
  },
  splash: {
    kind: "splash",
    name: "范围溅射塔",
    cost: 65,
    baseRange: 140,
    baseAttackInterval: 1.2,
    baseDamage: 14,
    splashRadius: 50,
    description: "攻击范围内造成溅射伤害，适合搭配AOE弹药应对密集小怪。",
    color: 0xff8a5a,
  },
};

export function getTowerDef(kind: TowerKind): TowerDef {
  return TOWERS[kind];
}
