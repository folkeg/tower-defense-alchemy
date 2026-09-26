import { LEVEL_1, type LevelDef, type WaveDef } from "../config/waves";
import { ENEMY_PATH, TOWER_SLOTS } from "../config/map";
import { getEnemyDef, type EnemyKind } from "../config/enemies";
import { getTowerDef, type TowerKind } from "../config/towers";
import { getMaterialById } from "../config/materials";
import { Wallet, computeKillReward } from "./economy";
import { craft, predictCraft, RecipeJournal, type AmmoTier, type Rng } from "./craftingEngine";
import { AmmoInstance, AmmoRack } from "./ammo";
import {
  EnemyInstance,
  TowerInstance,
  advanceEnemyAlongPath,
  fireTower,
  findTarget,
  tickEnemyEffects,
} from "./combat";

export type GamePhase = "prep" | "battle" | "level_complete" | "game_over";

interface SpawnTask {
  kind: EnemyKind;
  remaining: number;
  interval: number;
  timer: number;
}

export interface RunStats {
  totalKills: number;
  totalGoldEarned: number;
  wavesCleared: number;
  craftCount: number;
  greatSuccessCount: number;
  greatFailureCount: number;
}

export interface DamagePopup {
  x: number;
  y: number;
  amount: number;
  isCrit: boolean;
}

/**
 * 纯逻辑游戏会话控制器：不依赖 Phaser，驱动整局塔防+合成流程。
 * Phaser 场景只负责渲染这个对象的状态与转发玩家输入；
 * headless 模拟脚本也复用同一个类来批量跑数值验证。
 */
export class GameSession {
  readonly level: LevelDef;
  phase: GamePhase = "prep";
  waveIndex = 0;
  health: number;
  readonly wallet: Wallet;
  readonly rack: AmmoRack;
  readonly journal = new RecipeJournal();
  readonly towers: (TowerInstance | null)[];
  enemies: EnemyInstance[] = [];
  stats: RunStats = {
    totalKills: 0,
    totalGoldEarned: 0,
    wavesCleared: 0,
    craftCount: 0,
    greatSuccessCount: 0,
    greatFailureCount: 0,
  };

  private spawnQueue: SpawnTask[] = [];
  private rng: Rng;
  /** 最近一帧产生的伤害飘字，供渲染层消费后可清空 */
  lastDamagePopups: DamagePopup[] = [];

  constructor(level: LevelDef = LEVEL_1, rng: Rng = Math.random) {
    this.level = level;
    this.health = level.startingHealth;
    this.wallet = new Wallet(level.startingGold);
    this.rack = new AmmoRack();
    this.towers = new Array(TOWER_SLOTS.length).fill(null);
    this.rng = rng;
  }

  getCurrentWave(): WaveDef | null {
    return this.level.waves[this.waveIndex] ?? null;
  }

  isLastWave(): boolean {
    return this.waveIndex >= this.level.waves.length - 1;
  }

  // -- 备战阶段操作 --------------------------------------------------------

  buyMaterial(materialId: string): void {
    if (this.phase !== "prep") throw new Error("只能在备战阶段购买素材");
    this.wallet.buyMaterial(getMaterialById(materialId));
  }

  predictCraft(materialIds: string[]) {
    const materials = materialIds.map(getMaterialById);
    return predictCraft(materials);
  }

  craftAmmo(materialIds: string[], tier: AmmoTier): AmmoInstance {
    if (this.phase !== "prep") throw new Error("战斗阶段熔炉已锁定，无法合成");
    const materials = materialIds.map(getMaterialById);
    for (const id of materialIds) this.wallet.removeMaterial(id, 1);
    const result = craft(materials, tier, this.rng);
    this.journal.record(result.recipeKey);
    this.stats.craftCount += 1;
    if (result.outcomeTier === "great_success") this.stats.greatSuccessCount += 1;
    if (result.outcomeTier === "great_failure") this.stats.greatFailureCount += 1;
    const ammo = new AmmoInstance(result);
    this.rack.add(ammo);
    return ammo;
  }

  placeTower(kind: TowerKind, slotIndex: number): TowerInstance {
    if (this.phase !== "prep") throw new Error("只能在备战阶段建造炮塔");
    if (this.towers[slotIndex]) throw new Error("该格子已经有炮塔");
    const def = getTowerDef(kind);
    this.wallet.spendGold(def.cost);
    const tower = new TowerInstance(def, TOWER_SLOTS[slotIndex]);
    this.towers[slotIndex] = tower;
    return tower;
  }

  // -- 弹药装填（备战/战斗阶段均可） ----------------------------------------

  loadAmmoFromRack(slotIndex: number, rackIndex: number): void {
    const tower = this.towers[slotIndex];
    if (!tower) throw new Error("该格子没有炮塔");
    const ammo = this.rack.removeAt(rackIndex);
    if (!ammo) throw new Error("弹药架该格为空");

    if (tower.loadedAmmo) {
      const old = tower.loadedAmmo;
      tower.loadedAmmo = null;
      this.rack.returnToRack(old);
    }
    ammo.load();
    tower.loadedAmmo = ammo;
  }

  unloadAmmoToRack(slotIndex: number): boolean {
    const tower = this.towers[slotIndex];
    if (!tower || !tower.loadedAmmo) return false;
    const ok = this.rack.returnToRack(tower.loadedAmmo);
    if (ok) tower.loadedAmmo = null;
    return ok;
  }

  // -- 波次流程 --------------------------------------------------------

  startNextWave(): void {
    if (this.phase !== "prep") throw new Error("当前不在备战阶段");
    const wave = this.getCurrentWave();
    if (!wave) throw new Error("已经没有更多波次");
    this.spawnQueue = wave.spawns.map((s) => ({
      kind: s.kind,
      remaining: s.count,
      interval: s.interval,
      timer: 0,
    }));
    this.phase = "battle";
  }

  /** 主更新循环：推进敌人/炮塔/波次状态。deltaSeconds 建议 <= 0.1 以保证移动精度 */
  update(deltaSeconds: number): void {
    this.lastDamagePopups = [];
    if (this.phase !== "battle") return;

    this.updateSpawns(deltaSeconds);
    this.updateEnemies(deltaSeconds);
    this.updateTowers(deltaSeconds);
    this.checkWaveClear();
  }

  private updateSpawns(dt: number): void {
    for (const task of this.spawnQueue) {
      if (task.remaining <= 0) continue;
      task.timer -= dt;
      if (task.timer <= 0) {
        const enemy = new EnemyInstance(getEnemyDef(task.kind), ENEMY_PATH);
        this.enemies.push(enemy);
        task.remaining -= 1;
        task.timer = task.interval;
      }
    }
    this.spawnQueue = this.spawnQueue.filter((t) => t.remaining > 0);
  }

  private updateEnemies(dt: number): void {
    const survivors: EnemyInstance[] = [];
    for (const enemy of this.enemies) {
      tickEnemyEffects(enemy, dt);
      if (!enemy.isAlive()) {
        this.onEnemyKilled(enemy);
        continue;
      }
      advanceEnemyAlongPath(enemy, ENEMY_PATH, dt);
      if (enemy.reachedEnd) {
        this.health = Math.max(0, this.health - 1);
        if (this.health <= 0) this.phase = "game_over";
        continue;
      }
      survivors.push(enemy);
    }
    this.enemies = survivors;
  }

  private onEnemyKilled(enemy: EnemyInstance): void {
    this.stats.totalKills += 1;
    const reward = computeKillReward(enemy.def, this.rng);
    this.wallet.addGold(reward.gold);
    this.stats.totalGoldEarned += reward.gold;
    if (reward.droppedMaterial) this.wallet.addMaterial(reward.droppedMaterial.id, 1);
    if (reward.droppedRareMaterial) this.wallet.addMaterial(reward.droppedRareMaterial.id, 1);
  }

  private updateTowers(dt: number): void {
    for (const tower of this.towers) {
      if (!tower) continue;
      tower.tickCooldown(dt);
      tower.loadedAmmo?.tick(dt);
      if (tower.loadedAmmo?.isDepleted()) {
        tower.loadedAmmo = null;
      }
      if (!tower.canFire()) continue;
      const target = findTarget(tower, this.enemies);
      if (!target) continue;
      const outcome = fireTower(tower, target, this.enemies, this.rng);
      if (outcome) {
        this.lastDamagePopups.push({
          x: target.position.x,
          y: target.position.y,
          amount: outcome.damageDealt,
          isCrit: outcome.isCrit,
        });
      }
      if (tower.loadedAmmo?.isDepleted()) {
        tower.loadedAmmo = null;
      }
    }
  }

  private checkWaveClear(): void {
    if (this.phase !== "battle") return;
    if (this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.stats.wavesCleared += 1;
      if (this.isLastWave()) {
        this.phase = "level_complete";
      } else {
        this.waveIndex += 1;
        this.phase = "prep";
      }
    }
  }
}
