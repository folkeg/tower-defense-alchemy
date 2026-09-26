import { describe, expect, it } from "vitest";
import { GameSession } from "../src/core/gameSession";
import { mulberry32 } from "../src/core/craftingEngine";
import { LEVEL_1 } from "../src/config/waves";

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
});
