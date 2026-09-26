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
    baseRange: 110,
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
