import { describe, expect, it } from "vitest";
import { normalizeNumber, numberPart, sameNumber } from "../src/pricing/match";
import { bestProduct, type PcProduct } from "../src/pricing/pricecharting";

describe("collector numbers", () => {
  it("keeps what comes before a slash and after the last dash", () => {
    expect(numberPart("4/102")).toBe("4");
    expect(numberPart("LOB-001")).toBe("001");
    expect(numberPart("US175")).toBe("US175");
    expect(numberPart("#150")).toBe("150");
    expect(numberPart("  ")).toBeNull();
    expect(numberPart(null)).toBeNull();
    expect(numberPart("/102")).toBeNull();
  });

  it("drops leading zeros and lower-cases a suffix, and leaves anything else as it is", () => {
    expect(normalizeNumber("004")).toBe("4");
    expect(normalizeNumber("12A")).toBe("12a");
    expect(normalizeNumber("007B")).toBe("7b");
    expect(normalizeNumber("0")).toBe("0");
    expect(normalizeNumber("US175")).toBe("us175");
    expect(normalizeNumber(undefined)).toBeNull();
    expect(sameNumber("004/102", "4")).toBe(true);
    expect(sameNumber("4", "5")).toBe(false);
    expect(sameNumber(null, "5")).toBe(false);
  });
});

describe("choosing a product", () => {
  const product = (id: string): PcProduct => ({ id, "product-name": id, "console-name": "Console" });
  const scores: Record<string, number> = { low: 1, high: 3, middle: 2 };
  const score = (p: PcProduct) => scores[p.id] ?? 0;

  it("takes the best score, and nothing when the best is under the floor or there is nothing to take", () => {
    expect(bestProduct([product("low"), product("high"), product("middle")], score)?.id).toBe("high");
    expect(bestProduct([product("low")], score)).toBeNull();
    expect(bestProduct([product("low")], score, 1)?.id).toBe("low");
    expect(bestProduct([], score)).toBeNull();
  });
});
