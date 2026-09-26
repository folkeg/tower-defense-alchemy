/**
 * 素材配置：类型标签 + 属性向量贡献值。
 * 属性向量用于合成时按配方规则加权计算结果数值区间。
 */

export type MaterialTag = "fire" | "ice" | "explosive" | "poison" | "rare";

export interface AttributeVector {
  /** 基础伤害贡献 */
  damage: number;
  /** 射速贡献（每秒攻击次数的加成） */
  rate: number;
  /** 范围贡献（像素） */
  range: number;
  /** 特效强度（0-1，影响持续伤害/减速等辅助效果强度） */
  potency: number;
}

export interface MaterialDef {
  id: string;
  name: string;
  tag: MaterialTag;
  /** 商店购买价格（金币），rare 类型不可购买，只能掉落 */
  shopPrice: number | null;
  /** 该素材对属性向量的基础贡献 */
  vector: AttributeVector;
  /** 简介，展示在商店/图鉴中 */
  description: string;
  /** 掉落权重，用于普通随机掉落池（0 表示不参与普通掉落，只能商店购买或稀有掉落获得） */
  dropWeight: number;
}

export const MATERIALS: MaterialDef[] = [
  {
    id: "ember_dust",
    name: "火种粉",
    tag: "fire",
    shopPrice: 12,
    vector: { damage: 6, rate: 0, range: 0, potency: 0.3 },
    description: "基础火系素材，提升伤害并附带灼烧倾向。",
    dropWeight: 6,
  },
  {
    id: "frost_shard",
    name: "冰晶碎片",
    tag: "ice",
    shopPrice: 12,
    vector: { damage: 3, rate: -0.1, range: 5, potency: 0.35 },
    description: "基础冰系素材，降低射速但附带减速倾向。",
    dropWeight: 6,
  },
  {
    id: "blast_powder",
    name: "爆破粉末",
    tag: "explosive",
    shopPrice: 16,
    vector: { damage: 10, rate: -0.2, range: 20, potency: 0.2 },
    description: "基础爆炸素材，大幅提升伤害与范围，但拖慢射速。",
    dropWeight: 5,
  },
  {
    id: "venom_gland",
    name: "毒腺",
    tag: "poison",
    shopPrice: 14,
    vector: { damage: 2, rate: 0, range: 0, potency: 0.5 },
    description: "基础毒系素材，伤害较低但持续伤害倾向强。",
    dropWeight: 5,
  },
  {
    id: "salamander_core",
    name: "蝾螈之心",
    tag: "fire",
    shopPrice: 28,
    vector: { damage: 12, rate: 0.1, range: 0, potency: 0.4 },
    description: "进阶火系素材，全面强化火焰效果。",
    dropWeight: 2,
  },
  {
    id: "glacier_heart",
    name: "冰川之心",
    tag: "ice",
    shopPrice: 28,
    vector: { damage: 6, rate: -0.05, range: 15, potency: 0.55 },
    description: "进阶冰系素材，强化减速与范围。",
    dropWeight: 2,
  },
  {
    id: "starfall_shard",
    name: "陨星碎片",
    tag: "rare",
    shopPrice: null,
    vector: { damage: 20, rate: 0.15, range: 25, potency: 0.7 },
    description: "极稀有素材，全属性大幅提升，只能从精英/首领掉落获得。",
    dropWeight: 0,
  },
];

export function getMaterialById(id: string): MaterialDef {
  const found = MATERIALS.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown material id: ${id}`);
  return found;
}

export const SHOP_MATERIALS = MATERIALS.filter((m) => m.shopPrice !== null);
export const DROPPABLE_MATERIALS = MATERIALS.filter((m) => m.dropWeight > 0);
export const RARE_MATERIALS = MATERIALS.filter((m) => m.tag === "rare");
