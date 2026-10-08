import { describe, expect, it } from "vitest";
import {
  EXTERIORS,
  EXTERIOR_IDS,
  EXTERIOR_RANGES,
  exteriorForFloat,
  hasWear,
  isStackable,
  wearWithinTier,
} from "@/lib/types";

describe("what stacks and what does not", () => {
  it("keeps weapons, knives and gloves as individual objects", () => {
    for (const category of ["weapon", "knife", "glove"] as const) {
      expect(isStackable(category)).toBe(false);
      expect(hasWear(category)).toBe(true);
    }
  });

  it("stacks everything without a wear value", () => {
    for (const category of ["case", "sticker", "capsule", "agent", "graffiti", "key", "other"] as const) {
      expect(isStackable(category)).toBe(true);
      expect(hasWear(category)).toBe(false);
    }
  });
});

describe("float to exterior", () => {
  it("puts each tier's midpoint in its own tier", () => {
    for (const id of EXTERIOR_IDS) {
      const { min, max } = EXTERIOR_RANGES[id];
      expect(exteriorForFloat((min + max) / 2)).toBe(id);
    }
  });

  it("puts a boundary float in the worse tier, the way the game does", () => {
    // 0.07 is the first Minimal Wear, not the last Factory New.
    expect(exteriorForFloat(0.07)).toBe("minimal_wear");
    expect(exteriorForFloat(0.15)).toBe("field_tested");
    expect(exteriorForFloat(0.38)).toBe("well_worn");
    expect(exteriorForFloat(0.45)).toBe("battle_scarred");
  });

  it("covers both ends of the scale", () => {
    expect(exteriorForFloat(0)).toBe("factory_new");
    expect(exteriorForFloat(1)).toBe("battle_scarred");
  });

  it("has no answer for something that is not a wear value", () => {
    for (const value of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(exteriorForFloat(value)).toBeNull();
    }
  });

  it("leaves no gap between the tiers", () => {
    let previous = 0;
    for (const id of EXTERIOR_IDS) {
      expect(EXTERIOR_RANGES[id].min).toBe(previous);
      previous = EXTERIOR_RANGES[id].max;
    }
    expect(previous).toBe(1);
    expect(Object.keys(EXTERIORS)).toEqual(EXTERIOR_IDS);
  });
});

describe("wear within a tier", () => {
  it("says where in its own band a float sits", () => {
    // 0.15 and 0.38 bracket Field-Tested, so the middle is half way through.
    expect(wearWithinTier(0.15)).toBeCloseTo(0, 10);
    expect(wearWithinTier(0.265)).toBeCloseTo(0.5, 10);
    expect(wearWithinTier(0.3799)).toBeCloseTo(1, 2);
  });

  it("separates two copies the market prices identically", () => {
    // Both are Field-Tested and both list under the same name, but one is
    // nearly Minimal Wear and the other nearly Well-Worn.
    const clean = wearWithinTier(0.16)!;
    const rough = wearWithinTier(0.37)!;
    expect(exteriorForFloat(0.16)).toBe(exteriorForFloat(0.37));
    expect(rough - clean).toBeGreaterThan(0.8);
  });
});
