import { describe, expect, it } from "vitest";
import { craft, mulberry32 } from "../src/core/craftingEngine";
import {
  AmmoInstance,
  AmmoRack,
  AmmoRackFullError,
  TEMP_AMMO_DURATION_SECONDS,
  TEMP_AMMO_MAX_SHOTS,
} from "../src/core/ammo";
import { getMaterialById } from "../src/config/materials";

const fire = getMaterialById("ember_dust");
const ice = getMaterialById("frost_shard");
const rare = getMaterialById("starfall_shard");

function makeTempAmmo() {
  const result = craft([fire, ice], "temporary", mulberry32(1));
  return new AmmoInstance(result);
}

function makePermAmmo() {
  const result = craft([fire, ice, rare], "permanent", mulberry32(1));
  return new AmmoInstance(result);
}

describe("AmmoInstance lifecycle", () => {
  it("does not consume time while sitting in the rack", () => {
    const ammo = makeTempAmmo();
    ammo.tick(10);
    expect(ammo.remainingSeconds).toBe(TEMP_AMMO_DURATION_SECONDS);
    expect(ammo.status).toBe("in_rack");
  });

  it("starts the countdown only after being loaded onto a tower", () => {
    const ammo = makeTempAmmo();
    ammo.load();
    expect(ammo.status).toBe("loaded");
    ammo.tick(10);
    expect(ammo.remainingSeconds).toBe(TEMP_AMMO_DURATION_SECONDS - 10);
    ammo.tick(25);
    expect(ammo.status).toBe("depleted");
    expect(ammo.remainingSeconds).toBe(0);
  });

  it("depletes after max shots even if time remains", () => {
    const ammo = makeTempAmmo();
    ammo.load();
    for (let i = 0; i < TEMP_AMMO_MAX_SHOTS - 1; i++) {
      ammo.registerShot();
      expect(ammo.status).toBe("loaded");
    }
    ammo.registerShot();
    expect(ammo.status).toBe("depleted");
  });

  it("a depleted ammo cannot be reloaded", () => {
    const ammo = makeTempAmmo();
    ammo.load();
    ammo.tick(TEMP_AMMO_DURATION_SECONDS + 1);
    expect(() => ammo.load()).toThrow();
  });

  it("permanent ammo never depletes from time or shots", () => {
    const ammo = makePermAmmo();
    ammo.load();
    ammo.tick(10_000);
    for (let i = 0; i < 10_000; i++) ammo.registerShot();
    expect(ammo.status).toBe("loaded");
    expect(ammo.isDepleted()).toBe(false);
  });

  it("unloading returns ammo to in_rack without resetting elapsed time", () => {
    const ammo = makeTempAmmo();
    ammo.load();
    ammo.tick(5);
    ammo.unload();
    expect(ammo.status).toBe("in_rack");
    expect(ammo.remainingSeconds).toBe(TEMP_AMMO_DURATION_SECONDS - 5);
    // 放回架上不会消耗时间
    ammo.tick(100);
    expect(ammo.remainingSeconds).toBe(TEMP_AMMO_DURATION_SECONDS - 5);
  });
});

describe("AmmoRack", () => {
  it("enforces capacity and throws when full", () => {
    const rack = new AmmoRack(2);
    rack.add(makeTempAmmo());
    rack.add(makeTempAmmo());
    expect(rack.isFull()).toBe(true);
    expect(() => rack.add(makeTempAmmo())).toThrow(AmmoRackFullError);
  });

  it("removeAt frees the slot for reuse", () => {
    const rack = new AmmoRack(1);
    const ammo = makeTempAmmo();
    rack.add(ammo);
    expect(rack.isFull()).toBe(true);
    const removed = rack.removeAt(0);
    expect(removed).toBe(ammo);
    expect(rack.isFull()).toBe(false);
    rack.add(makeTempAmmo());
    expect(rack.isFull()).toBe(true);
  });

  it("returnToRack unloads the ammo and places it back if there is room", () => {
    const rack = new AmmoRack(1);
    const ammo = makeTempAmmo();
    rack.add(ammo);
    rack.removeAt(0);
    ammo.load();
    const ok = rack.returnToRack(ammo);
    expect(ok).toBe(true);
    expect(ammo.status).toBe("in_rack");
    expect(rack.isFull()).toBe(true);
  });
});
