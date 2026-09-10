import { describe, expect, it } from "vitest";
import { normalizeNumber, numberPart, sameNumber, toNumber, tokenOverlap } from "@/lib/pricing/match";

describe("match helpers", () => {
  it("extracts the collector number from common formats", () => {
    expect(numberPart("4/102")).toBe("4");
    expect(numberPart("LOB-001")).toBe("001");
    expect(numberPart("#150")).toBe("150");
    expect(numberPart("US175")).toBe("US175");
    expect(numberPart(null)).toBeNull();
  });
  it("compares numbers ignoring leading zeros and denominators", () => {
    expect(sameNumber("004/102", "4")).toBe(true);
    expect(normalizeNumber("LOB-001")).toBe("1");
    expect(sameNumber("4/102", "5")).toBe(false);
    expect(sameNumber(null, "5")).toBe(false);
  });
  it("scores token overlap", () => {
    expect(tokenOverlap("Base Set", "Pokemon Base Set")).toBe(1);
    expect(tokenOverlap("Jungle", "Pokemon Base Set")).toBe(0);
  });
  it("parses prices from strings", () => {
    expect(toNumber("$1,234.50")).toBe(1234.5);
    expect(toNumber("0.00")).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});
