export type EnemyKind = "grunt" | "runner" | "tank";

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  /** 生命值 */
  hp: number;
  /** 移动速度（像素/秒） */
  speed: number;
  /** 护甲（百分比减伤，0-1） */
  armor: number;
  /** 击杀掉落金币区间 [min, max] */
  goldDrop: [number, number];
  /** 击杀后掉落普通素材的概率（0-1） */
  materialDropChance: number;
  /** 是否为精英/首领（拥有稀有素材掉落概率） */
  isElite: boolean;
  /** 精英稀有掉落概率（仅 isElite 生效） */
  rareDropChance: number;
  /** 渲染颜色与半径 */
  color: number;
  radius: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  grunt: {
    kind: "grunt",
    name: "普通兵",
    hp: 55,
    speed: 60,
    armor: 0,
    goldDrop: [3, 5],
    materialDropChance: 0.12,
    isElite: false,
    rareDropChance: 0,
    color: 0xcccccc,
    radius: 12,
  },
  runner: {
    kind: "runner",
    name: "快速兵",
    hp: 32,
    speed: 110,
    armor: 0,
    goldDrop: [2, 4],
    materialDropChance: 0.15,
    isElite: false,
    rareDropChance: 0,
    color: 0xffe14d,
    radius: 10,
  },
  tank: {
    kind: "tank",
    name: "坦克兵",
    hp: 210,
    speed: 32,
    armor: 0.35,
    goldDrop: [8, 14],
    materialDropChance: 0.2,
    isElite: true,
    rareDropChance: 0.06,
    color: 0x7a5230,
    radius: 18,
  },
};

export function getEnemyDef(kind: EnemyKind): EnemyDef {
  return ENEMIES[kind];
}
