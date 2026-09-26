import { describe, expect, it } from "vitest";
import { computeKillReward, Wallet, WalletError } from "../src/core/economy";
import { mulberry32 } from "../src/core/craftingEngine";
import { ENEMIES } from "../src/config/enemies";
import { getMaterialById } from "../src/config/materials";

describe("computeKillReward", () => {
  it("always drops gold within the enemy's configured range", () => {
    for (let seed = 0; seed < 100; seed++) {
      const reward = computeKillReward(ENEMIES.grunt, mulberry32(seed));
      expect(reward.gold).toBeGreaterThanOrEqual(ENEMIES.grunt.goldDrop[0]);
      expect(reward.gold).toBeLessThanOrEqual(ENEMIES.grunt.goldDrop[1]);
    }
  });

  it("non-elite enemies never drop rare materials", () => {
    for (let seed = 0; seed < 200; seed++) {
      const reward = computeKillReward(ENEMIES.runner, mulberry32(seed));
      expect(reward.droppedRareMaterial).toBeNull();
    }
  });

  it("elite enemies can drop rare materials over many trials", () => {
    let rareDrops = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const reward = computeKillReward(ENEMIES.tank, mulberry32(seed * 13 + 3));
      if (reward.droppedRareMaterial) rareDrops++;
    }
    expect(rareDrops).toBeGreaterThan(0);
  });
});

describe("Wallet", () => {
  it("tracks gold correctly and throws on overspend", () => {
    const wallet = new Wallet(50);
    wallet.addGold(10);
    expect(wallet.getGold()).toBe(60);
    wallet.spendGold(60);
    expect(wallet.getGold()).toBe(0);
    expect(() => wallet.spendGold(1)).toThrow(WalletError);
  });

  it("buying a material spends gold and adds to inventory", () => {
    const wallet = new Wallet(100);
    const material = getMaterialById("ember_dust");
    wallet.buyMaterial(material);
    expect(wallet.getGold()).toBe(100 - material.shopPrice!);
    expect(wallet.getMaterialCount(material.id)).toBe(1);
  });

  it("cannot buy a non-shop (rare) material", () => {
    const wallet = new Wallet(1000);
    const rare = getMaterialById("starfall_shard");
    expect(() => wallet.buyMaterial(rare)).toThrow(WalletError);
  });

  it("removing more materials than owned throws", () => {
    const wallet = new Wallet(100);
    wallet.addMaterial("ember_dust", 1);
    expect(() => wallet.removeMaterial("ember_dust", 2)).toThrow(WalletError);
  });
});
