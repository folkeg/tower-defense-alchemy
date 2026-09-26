import { describe, expect, it, beforeEach } from "vitest";
import {
  EnemyInstance,
  TowerInstance,
  advanceEnemyAlongPath,
  applyAmmoEffect,
  fireTower,
  findTarget,
  pathTotalLength,
  resetEnemyIdCounter,
  resetTowerIdCounter,
  tickEnemyEffects,
} from "../src/core/combat";
import { ENEMIES } from "../src/config/enemies";
import { TOWERS } from "../src/config/towers";
import { craft, mulberry32 } from "../src/core/craftingEngine";
import { AmmoInstance } from "../src/core/ammo";
import { getMaterialById } from "../src/config/materials";
import type { Point } from "../src/config/map";

const straightPath: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

beforeEach(() => {
  resetEnemyIdCounter();
  resetTowerIdCounter();
});

describe("advanceEnemyAlongPath", () => {
  it("moves along the polyline and marks reachedEnd at the final point", () => {
    const enemy = new EnemyInstance(ENEMIES.grunt, straightPath);
    const total = pathTotalLength(straightPath);
    const secondsToFinish = total / enemy.def.speed;

    advanceEnemyAlongPath(enemy, straightPath, secondsToFinish / 2);
    expect(enemy.reachedEnd).toBe(false);
    expect(enemy.distanceTraveled).toBeCloseTo(total / 2, 0);

    advanceEnemyAlongPath(enemy, straightPath, secondsToFinish / 2 + 1);
    expect(enemy.reachedEnd).toBe(true);
    expect(enemy.position).toEqual(straightPath[straightPath.length - 1]);
  });

  it("slow effects reduce effective speed", () => {
    const enemy = new EnemyInstance(ENEMIES.grunt, straightPath);
    applyAmmoEffect(enemy, "slow", 10, 0.5);
    expect(enemy.getEffectiveSpeed()).toBeLessThan(enemy.def.speed);
  });
});

describe("tickEnemyEffects", () => {
  it("applies burn/poison damage per second and expires after duration", () => {
    const enemy = new EnemyInstance(ENEMIES.grunt, straightPath);
    const hpBefore = enemy.hp;
    applyAmmoEffect(enemy, "burn", 20, 0.5);
    tickEnemyEffects(enemy, 1);
    expect(enemy.hp).toBeLessThan(hpBefore);
    expect(enemy.effects.length).toBe(1);

    tickEnemyEffects(enemy, 10);
    expect(enemy.effects.length).toBe(0);
  });

  it("hp never goes below zero", () => {
    const enemy = new EnemyInstance(ENEMIES.grunt, straightPath);
    applyAmmoEffect(enemy, "poison", 10000, 1);
    tickEnemyEffects(enemy, 10);
    expect(enemy.hp).toBe(0);
  });
});

describe("findTarget", () => {
  it("prioritizes the enemy furthest along the path within range", () => {
    const tower = new TowerInstance(TOWERS.melee, { x: 50, y: 0 });
    const near = new EnemyInstance(ENEMIES.grunt, straightPath);
    near.distanceTraveled = 10;
    near.position = { x: 40, y: 0 };
    const far = new EnemyInstance(ENEMIES.grunt, straightPath);
    far.distanceTraveled = 90;
    far.position = { x: 60, y: 0 };

    const target = findTarget(tower, [near, far]);
    expect(target?.id).toBe(far.id);
  });

  it("ignores enemies out of range", () => {
    const tower = new TowerInstance(TOWERS.melee, { x: 0, y: 0 });
    const farAway = new EnemyInstance(ENEMIES.grunt, straightPath);
    farAway.position = { x: 100000, y: 0 };
    expect(findTarget(tower, [farAway])).toBeNull();
  });
});

describe("fireTower", () => {
  it("deals damage reduced by armor and consumes ammo shots", () => {
    const tower = new TowerInstance(TOWERS.melee, { x: 0, y: 0 });
    const fire = getMaterialById("ember_dust");
    const ice = getMaterialById("frost_shard");
    const craftResult = craft([fire, ice], "temporary", mulberry32(5));
    const ammo = new AmmoInstance(craftResult);
    ammo.load();
    tower.loadedAmmo = ammo;

    const target = new EnemyInstance(ENEMIES.tank, straightPath); // has armor 0.35
    const outcome = fireTower(tower, target, [target], mulberry32(1));

    expect(outcome).not.toBeNull();
    expect(tower.cooldownRemaining).toBeGreaterThan(0);
    expect(ammo.remainingShots).toBe(49);
    expect(target.hp).toBeLessThan(ENEMIES.tank.hp);
  });

  it("cannot fire while on cooldown", () => {
    const tower = new TowerInstance(TOWERS.melee, { x: 0, y: 0 });
    tower.cooldownRemaining = 1;
    const target = new EnemyInstance(ENEMIES.grunt, straightPath);
    expect(fireTower(tower, target, [target])).toBeNull();
  });

  it("AOE ammo splashes damage to nearby enemies but not far ones", () => {
    const tower = new TowerInstance(TOWERS.splash, { x: 0, y: 0 });
    const explosive = getMaterialById("blast_powder");
    const fire = getMaterialById("ember_dust");
    const craftResult = craft([explosive, fire], "temporary", mulberry32(3));
    expect(craftResult.isAoe).toBe(true);
    const ammo = new AmmoInstance(craftResult);
    ammo.load();
    tower.loadedAmmo = ammo;

    const target = new EnemyInstance(ENEMIES.grunt, straightPath);
    target.position = { x: 10, y: 0 };
    const nearby = new EnemyInstance(ENEMIES.grunt, straightPath);
    nearby.position = { x: 30, y: 0 };
    const farAway = new EnemyInstance(ENEMIES.grunt, straightPath);
    farAway.position = { x: 10000, y: 0 };

    const outcome = fireTower(tower, target, [target, nearby, farAway], mulberry32(2));
    expect(outcome!.splashHits.some((h) => h.targetId === nearby.id)).toBe(true);
    expect(outcome!.splashHits.some((h) => h.targetId === farAway.id)).toBe(false);
  });

  it("falls back to base tower damage when no ammo is loaded", () => {
    const tower = new TowerInstance(TOWERS.melee, { x: 0, y: 0 });
    const target = new EnemyInstance(ENEMIES.grunt, straightPath);
    const outcome = fireTower(tower, target, [target], mulberry32(1));
    expect(outcome!.damageDealt).toBeCloseTo(TOWERS.melee.baseDamage, 5);
  });
});
