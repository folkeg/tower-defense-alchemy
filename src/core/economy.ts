import { DROPPABLE_MATERIALS, RARE_MATERIALS, type MaterialDef } from "../config/materials";
import type { EnemyDef } from "../config/enemies";
import type { Rng } from "./craftingEngine";

export interface KillRewardResult {
  gold: number;
  droppedMaterial: MaterialDef | null;
  droppedRareMaterial: MaterialDef | null;
}

function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

function pickWeighted(rng: Rng, pool: MaterialDef[]): MaterialDef | null {
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, m) => sum + m.dropWeight, 0);
  // 池内素材权重全为 0（例如稀有素材池只按"是否掉落"过滤，权重不参与判定）时，均匀选取
  if (total <= 0) {
    const index = Math.floor(rng() * pool.length);
    return pool[Math.min(index, pool.length - 1)];
  }
  let roll = rng() * total;
  for (const m of pool) {
    roll -= m.dropWeight;
    if (roll <= 0) return m;
  }
  return pool[pool.length - 1];
}

/**
 * 击杀奖励计算：金币必掉，普通素材按 materialDropChance 概率掉落，
 * 精英/首领敌人额外按 rareDropChance 概率掉落稀有素材。
 */
export function computeKillReward(enemy: EnemyDef, rng: Rng = Math.random): KillRewardResult {
  const gold = randomInt(rng, enemy.goldDrop[0], enemy.goldDrop[1]);

  let droppedMaterial: MaterialDef | null = null;
  if (rng() < enemy.materialDropChance) {
    droppedMaterial = pickWeighted(rng, DROPPABLE_MATERIALS);
  }

  let droppedRareMaterial: MaterialDef | null = null;
  if (enemy.isElite && rng() < enemy.rareDropChance) {
    droppedRareMaterial = pickWeighted(rng, RARE_MATERIALS);
  }

  return { gold, droppedMaterial, droppedRareMaterial };
}

export class WalletError extends Error {}

/** 玩家经济状态：金币 + 素材背包（按 id 计数） */
export class Wallet {
  private gold: number;
  private materials = new Map<string, number>();

  constructor(startingGold: number) {
    this.gold = startingGold;
  }

  getGold(): number {
    return this.gold;
  }

  addGold(amount: number): void {
    this.gold += amount;
  }

  spendGold(amount: number): void {
    if (amount > this.gold) {
      throw new WalletError(`金币不足：需要 ${amount}，当前 ${this.gold}`);
    }
    this.gold -= amount;
  }

  addMaterial(materialId: string, count = 1): void {
    this.materials.set(materialId, (this.materials.get(materialId) ?? 0) + count);
  }

  removeMaterial(materialId: string, count = 1): void {
    const current = this.materials.get(materialId) ?? 0;
    if (current < count) {
      throw new WalletError(`素材不足：${materialId} 需要 ${count}，当前 ${current}`);
    }
    this.materials.set(materialId, current - count);
  }

  getMaterialCount(materialId: string): number {
    return this.materials.get(materialId) ?? 0;
  }

  /** 从商店购买一个素材，扣款并加入背包 */
  buyMaterial(material: MaterialDef): void {
    if (material.shopPrice === null) {
      throw new WalletError(`${material.name} 无法在商店购买`);
    }
    this.spendGold(material.shopPrice);
    this.addMaterial(material.id, 1);
  }
}
