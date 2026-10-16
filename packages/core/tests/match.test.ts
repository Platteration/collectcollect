import { describe, expect, it } from "vitest";
import { norm, normalizeNumber, numberPart, round2, sameNumber, setSimilarity, similarity, toNumber, tokenOverlap, tokens } from "../src/pricing/match";
import { bestProduct, type PcProduct } from "../src/pricing/pricecharting";

/**
 * The text-matching helpers the domain apps' price providers share. The "match
 * helpers" block is the card app's own test of its copy
 * (apps/cards/tests/match.test.ts), so the two keep behaving the same.
 */
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

describe("what the helpers do with the edges of a number", () => {
  it("has no number in an empty part, and keeps the letters of one that has them", () => {
    expect(numberPart("/102")).toBeNull();
    expect(numberPart("   ")).toBeNull();
    expect(numberPart("-")).toBeNull();
    expect(normalizeNumber("004a")).toBe("4a");
    expect(normalizeNumber("12B/40")).toBe("12b");
    expect(normalizeNumber("US175")).toBe("us175");
    expect(normalizeNumber("000")).toBe("0");
  });
});

describe("the rest of the helpers", () => {
  it("splits on punctuation and lowercases", () => {
    expect(tokens("Spider-Man #300 (1st print)")).toEqual(["spider", "man", "300", "1st", "print"]);
    expect(tokens(null)).toEqual([]);
  });
  it("scores similarity both ways and ignores filler words in a set name", () => {
    expect(similarity("Base Set", "Base Set")).toBe(1);
    expect(similarity("Base", "Base Set 2")).toBeLessThan(1);
    expect(similarity(null, "x")).toBe(0);
    expect(setSimilarity("Base Set", "Base")).toBe(1);
    expect(setSimilarity("Base Set", "Base Set 2")).toBeLessThan(1);
  });
  it("rounds to cents and compares spellings by letters and digits alone", () => {
    expect(round2(1.236)).toBe(1.24);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(norm("Super-Mario 64!")).toBe("supermario64");
    expect(norm(null)).toBe("");
  });
});
