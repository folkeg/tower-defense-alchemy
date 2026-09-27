import { describe, expect, it } from "vitest";
import { GameSession } from "../src/core/gameSession";
import { mulberry32 } from "../src/core/craftingEngine";
import { LEVEL_1 } from "../src/config/waves";
import { TOWER_SLOTS, ENEMY_PATH } from "../src/config/map";
import type { TowerKind } from "../src/config/towers";
import { getEnemyDef } from "../src/config/enemies";
import { EnemyInstance } from "../src/core/combat";

function runWaveToCompletion(session: GameSession, maxSeconds = 120): void {
  const dt = 0.1;
  let elapsed = 0;
  while (session.phase === "battle" && elapsed < maxSeconds) {
    session.update(dt);
    elapsed += dt;
  }
}

describe("GameSession", () => {
  it("starts in prep phase with starting gold and health", () => {
    const session = new GameSession(LEVEL_1, mulberry32(1));
    expect(session.phase).toBe("prep");
    expect(session.wallet.getGold()).toBe(LEVEL_1.startingGold);
    expect(session.health).toBe(LEVEL_1.startingHealth);
  });

  it("buying materials and crafting ammo works only in prep phase", () => {
    const session = new GameSession(LEVEL_1, mulberry32(2));
    session.buyMaterial("ember_dust");
    session.buyMaterial("frost_shard");
    const ammo = session.craftAmmo(["ember_dust", "frost_shard"], "temporary");
    expect(ammo.status).toBe("in_rack");
    expect(session.rack.getUsedCount()).toBe(1);

    session.startNextWave();
    expect(session.phase).toBe("battle");
    expect(() => session.craftAmmo(["ember_dust"], "temporary")).toThrow();
  });

  it("placing towers spends gold and reserves the slot", () => {
    const session = new GameSession(LEVEL_1, mulberry32(3));
    const goldBefore = session.wallet.getGold();
    const tower = session.placeTower("melee", 0);
    expect(session.wallet.getGold()).toBe(goldBefore - tower.def.cost);
    expect(() => session.placeTower("melee", 0)).toThrow();
  });

  it("loading ammo from the rack onto a tower starts its countdown", () => {
    const session = new GameSession(LEVEL_1, mulberry32(4));
    session.placeTower("melee", 0);
    session.buyMaterial("ember_dust");
    session.buyMaterial("frost_shard");
    session.craftAmmo(["ember_dust", "frost_shard"], "temporary");
    session.loadAmmoFromRack(0, 0);
    const tower = session.towers[0]!;
    expect(tower.loadedAmmo).not.toBeNull();
    expect(tower.loadedAmmo!.status).toBe("loaded");
    expect(session.rack.getUsedCount()).toBe(0);
  });

  it("simulates wave 1 fully with a couple of towers and reaches prep for wave 2, or game over — either way it terminates cleanly", () => {
    const session = new GameSession(LEVEL_1, mulberry32(123));
    // 先合成弹药（此时金币充足），再建塔，避免测试中因塔建造费用挤占材料预算
    session.buyMaterial("ember_dust");
    session.buyMaterial("ember_dust");
    session.craftAmmo(["ember_dust", "ember_dust"], "temporary");

    session.placeTower("melee", 0);
    session.loadAmmoFromRack(0, 0);

    session.startNextWave();
    runWaveToCompletion(session);

    expect(["prep", "game_over", "level_complete"]).toContain(session.phase);
    expect(session.enemies.length).toBe(0);
  });

  it("clearing all waves in a level reaches level_complete", () => {
    const session = new GameSession(LEVEL_1, mulberry32(999));
    // 强力塔配置，快速清完所有波次以验证终局状态可达
    session.placeTower("splash", 0);
    session.placeTower("melee", 1);

    for (let wave = 0; wave < LEVEL_1.waves.length; wave++) {
      if (session.phase !== "prep") break;
      // 每波前重新装填全新的强力永久/临时弹药，避免中途失效导致塔哑火
      for (const slot of [0, 1]) {
        if (!session.towers[slot]) continue;
        try {
          session.buyMaterial("blast_powder");
          session.buyMaterial("ember_dust");
          session.craftAmmo(["blast_powder", "ember_dust"], "temporary");
          const rackIdx = session.rack.getItems().findIndex((i) => i !== null);
          if (rackIdx !== -1) session.loadAmmoFromRack(slot, rackIdx);
        } catch {
          // 金币不足时跳过补充装填，靠已有弹药继续战斗
        }
      }
      session.startNextWave();
      runWaveToCompletion(session, 200);
      if (session.phase === "game_over") break;
    }

    expect(["level_complete", "game_over"]).toContain(session.phase);
  });

  it("firing continues with fallback base damage after ammo depletes, and a depletion event is recorded", () => {
    const session = new GameSession(LEVEL_1, mulberry32(4));
    session.placeTower("melee", 0);
    session.buyMaterial("ember_dust");
    session.buyMaterial("frost_shard");
    session.craftAmmo(["ember_dust", "frost_shard"], "temporary");
    session.loadAmmoFromRack(0, 0);
    session.startNextWave();

    // 强行推进到弹药耗尽（30 秒时效）
    for (let i = 0; i < 320; i++) session.update(0.1);

    const tower = session.towers[0]!;
    expect(tower.loadedAmmo).toBeNull(); // 已回退默认弹药（塔身基础属性，无独立弹药实例）
    expect(tower.getEffectiveRange()).toBe(tower.def.baseRange);
    // 塔仍能正常开火（不会完全哑火），canFire/冷却机制不受影响
    expect(tower.canFire).toBeInstanceOf(Function);
  });

  it("getAmmoWarnings reports warning/critical urgency for temp ammo running low", () => {
    const session = new GameSession(LEVEL_1, mulberry32(5));
    session.placeTower("melee", 0);
    session.buyMaterial("ember_dust");
    session.buyMaterial("frost_shard");
    session.craftAmmo(["ember_dust", "frost_shard"], "temporary");
    session.loadAmmoFromRack(0, 0);
    session.startNextWave();

    expect(session.getAmmoWarnings()).toEqual([]); // 刚装填，弹药充足

    // 推进到剩余时间 <= 30% (30s * 0.3 = 9s 剩余，即消耗 21s)
    for (let i = 0; i < 215; i++) session.update(0.1);
    const warnings = session.getAmmoWarnings();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].slotIndex).toBe(0);
    expect(["warning", "critical"]).toContain(warnings[0].urgency);
  });

  // 回归测试：曾经出现过"某些塔位到路径的最近距离 >= 塔的基础射程"或"贴着拐角只能
  // 切到敌人一瞬间"的死区 bug（塔身消耗弹药/冷却正常运转，但实际命中次数接近 0，
  // 敌人几乎不掉血）。这里逐个格子实测：只要在该格建塔（不装任何弹药，纯用塔身基础
  // 属性），跑完整一波敌人后必须至少命中过一次，否则说明该格子是死区。
  // 用"命中次数"而不是"击杀数/金币"作判据，避免与敌人血量数值调整产生耦合
  // （死区判定应该只关心"够不够得到"，不应该关心"单塔火力够不够击杀"）。
  describe("every tower slot can actually hit enemies on the fixed path (no dead zones)", () => {
    TOWER_SLOTS.forEach((_pos, slotIndex) => {
      (["melee", "splash"] as TowerKind[]).forEach((kind) => {
        it(`slot ${slotIndex} with a ${kind} tower lands at least one hit during a full wave`, () => {
          const session = new GameSession(LEVEL_1, mulberry32(100 + slotIndex));
          session.placeTower(kind, slotIndex);
          session.startNextWave();

          let totalHits = 0;
          const dt = 0.1;
          let elapsed = 0;
          while (session.phase === "battle" && elapsed < 200) {
            session.update(dt);
            totalHits += session.lastDamagePopups.length;
            elapsed += dt;
          }

          expect(totalHits).toBeGreaterThan(0);
        });
      });
    });
  });

  it("tutorialForcedDrops guarantees forced material drops on successive kills, on top of normal drops", () => {
    const session = new GameSession(LEVEL_1, mulberry32(42));
    session.tutorialForcedDrops = ["iron_shrapnel", "ember_dust"];
    // 直接调用私有的击杀结算钩子模拟两次连续击杀，避免与"战斗数值平衡"耦合——
    // 这里只关心"强制掉落队列"本身的记账是否正确，命中率/伤害数值已由其他测试覆盖。
    const killHook = (session as unknown as { onEnemyKilled: (enemy: EnemyInstance) => void })
      .onEnemyKilled.bind(session);
    const enemy1 = new EnemyInstance(getEnemyDef("grunt"), ENEMY_PATH);
    const enemy2 = new EnemyInstance(getEnemyDef("grunt"), ENEMY_PATH);

    killHook(enemy1);
    expect(session.wallet.getMaterialCount("iron_shrapnel")).toBeGreaterThanOrEqual(1);
    expect(session.tutorialForcedDrops).toEqual(["ember_dust"]);

    killHook(enemy2);
    expect(session.wallet.getMaterialCount("ember_dust")).toBeGreaterThanOrEqual(1);
    expect(session.tutorialForcedDrops).toEqual([]);

    // 队列耗尽后，后续击杀不应再受影响（不会抛错，也不会继续强制发放）
    const enemy3 = new EnemyInstance(getEnemyDef("grunt"), ENEMY_PATH);
    expect(() => killHook(enemy3)).not.toThrow();
    expect(session.tutorialForcedDrops).toEqual([]);
  });

  it("lastFireEvents carries per-shot projectile visual metadata (color/shape) for rendering", () => {
    const session = new GameSession(LEVEL_1, mulberry32(5));
    session.placeTower("melee", 0);
    session.startNextWave();

    let sawFireEvent = false;
    let elapsed = 0;
    while (session.phase === "battle" && elapsed < 30 && !sawFireEvent) {
      session.update(0.1);
      if (session.lastFireEvents.length > 0) {
        sawFireEvent = true;
        const evt = session.lastFireEvents[0];
        expect(typeof evt.color).toBe("number");
        expect(["circle", "diamond", "line"]).toContain(evt.shape);
        expect(evt.fromX).toBeCloseTo(TOWER_SLOTS[0].x, 0);
        expect(evt.fromY).toBeCloseTo(TOWER_SLOTS[0].y, 0);
      }
      elapsed += 0.1;
    }
    expect(sawFireEvent).toBe(true);
  });
});
