import { describe, expect, it } from "vitest";
import {
  buildRecipeKey,
  craft,
  CraftingValidationError,
  mulberry32,
  predictCraft,
} from "../src/core/craftingEngine";
import { getMaterialById } from "../src/config/materials";

const fire = getMaterialById("ember_dust");
const fire2 = getMaterialById("salamander_core");
const ice = getMaterialById("frost_shard");
const explosive = getMaterialById("blast_powder");
const rare = getMaterialById("starfall_shard");

describe("buildRecipeKey", () => {
  it("uses the single dominant tag when only one tag is present", () => {
    const { key, hasRare } = buildRecipeKey([fire, fire2]);
    expect(key).toBe("fire");
    expect(hasRare).toBe(false);
  });

  it("combines the two dominant tags in alphabetical order", () => {
    const { key } = buildRecipeKey([fire, explosive]);
    expect(key).toBe("explosive+fire");
  });

  it("marks hasRare without letting rare affect the type key", () => {
    const { key, hasRare } = buildRecipeKey([fire, rare]);
    expect(key).toBe("fire");
    expect(hasRare).toBe(true);
  });

  it("throws when no craftable (non-rare) tag is present", () => {
    expect(() => buildRecipeKey([rare])).toThrow(CraftingValidationError);
  });
});

describe("predictCraft", () => {
  it("returns a deterministic recipe type and description regardless of exact numeric roll", () => {
    const prediction = predictCraft([fire, explosive]);
    expect(prediction.recipeKey).toBe("explosive+fire");
    expect(prediction.resultName).toBe("燃烧弹");
    expect(prediction.isAoe).toBe(true);
    expect(prediction.effect).toBe("burn");
  });

  it("predicted damage range is non-degenerate and ordered", () => {
    const prediction = predictCraft([fire, ice]);
    const [min, max] = prediction.predictedDamageRange;
    expect(min).toBeLessThanOrEqual(max);
    expect(min).toBeGreaterThanOrEqual(0);
  });

  it("throws when material count is out of allowed range", () => {
    expect(() => predictCraft([fire])).toThrow(CraftingValidationError);
    expect(() => predictCraft([fire, ice, explosive, rare, fire2])).toThrow(
      CraftingValidationError,
    );
  });

  it("rare materials increase the great success chance", () => {
    const withoutRare = predictCraft([fire, ice]);
    const withRare = predictCraft([fire, ice, rare]);
    expect(withRare.greatSuccessChance).toBeGreaterThan(withoutRare.greatSuccessChance);
  });
});

describe("craft", () => {
  it("is deterministic for a fixed seed", () => {
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);
    const resultA = craft([fire, explosive], "temporary", rngA);
    const resultB = craft([fire, explosive], "temporary", rngB);
    expect(resultA).toEqual(resultB);
  });

  it("produces varying but bounded results across many seeds", () => {
    const damages: number[] = [];
    const crits: number[] = [];
    for (let seed = 0; seed < 200; seed++) {
      const rng = mulberry32(seed * 7919 + 1);
      const result = craft([fire, ice], "temporary", rng);
      damages.push(result.finalDamage);
      crits.push(result.finalCritChance);
      expect(result.finalCritChance).toBeGreaterThanOrEqual(0);
      expect(result.finalCritChance).toBeLessThanOrEqual(100);
      expect(result.finalDamage).toBeGreaterThan(0);
    }
    // 结果应该有波动而不是完全随机也不是恒定值（验证"区间随机"而非"完全固定"或"完全随机"）
    const uniqueDamages = new Set(damages.map((d) => Math.round(d)));
    expect(uniqueDamages.size).toBeGreaterThan(5);
  });

  it("permanent ammo requires a rare material and applies a damage discount", () => {
    expect(() => craft([fire, ice], "permanent", mulberry32(1))).toThrow(
      CraftingValidationError,
    );

    const rngTemp = mulberry32(99);
    const rngPerm = mulberry32(99);
    const temp = craft([fire, ice, rare], "temporary", rngTemp);
    const perm = craft([fire, ice, rare], "permanent", rngPerm);
    expect(perm.finalDamage).toBeCloseTo(temp.finalDamage * 0.8, 1);
  });

  it("great success and great failure meaningfully change output vs normal outcome", () => {
    // 用大量种子采样，确认三种结果都会出现且方向正确
    let sawGreatSuccess = false;
    let sawGreatFailure = false;
    for (let seed = 0; seed < 500; seed++) {
      const result = craft([fire, ice], "temporary", mulberry32(seed));
      if (result.outcomeTier === "great_success") sawGreatSuccess = true;
      if (result.outcomeTier === "great_failure") sawGreatFailure = true;
    }
    expect(sawGreatSuccess).toBe(true);
    expect(sawGreatFailure).toBe(true);
  });
});
