import { describe, expect, it } from "vitest";
import { spec } from "@/lib/spec";
import { isBottleNumber } from "@/lib/types";

/**
 * A bottle number is text the app did not write: a spreadsheet cell, a
 * request, a restored file. It is read on the one thread every request shares,
 * with a pattern that had a space slot on each side of an optional word, so a
 * run of spaces could be split between the two every way there is: twenty
 * thousand spaces took a quarter of a second and the time grew with the square
 * of the run. The budget is far above what a scan costs and far below what
 * that did. (CLAUDE.md, "Input from outside".)
 */
const BUDGET_MS = 1000;

function timed<T>(read: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = read();
  return { value, ms: performance.now() - started };
}

/** Short strings drawn from `tokens`, the same ones for the same seed. */
function drawn(tokens: string[], count: number, seed: number, most = 8): string[] {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => {
    let text = "";
    for (let n = Math.floor(next() * (most + 1)); n > 0; n--) text += tokens[Math.floor(next() * tokens.length)];
    return text;
  });
}

describe("a bottle number", () => {
  it("is read in linear time however long its runs of spaces are", () => {
    const run = " ".repeat(200_000);
    for (const text of [`${run}x`, `#${run}x`, `bottle${run}1${run}of${run}x`, `${run}1/1${run}x`, `\t${run}no.${run}`]) {
      const read = timed(() => isBottleNumber(text));
      expect(read.value, text.trim().slice(0, 12)).toBe(false);
      expect(read.ms, text.trim().slice(0, 12)).toBeLessThan(BUDGET_MS);
    }
    const long = timed(() => isBottleNumber(`${run}Bottle${run}12${run}of${run}2000${run}`));
    expect(long.value).toBe(true);
    expect(long.ms).toBeLessThan(BUDGET_MS);
  });

  it("decides in linear time whether a sealed bottle is one of a kind", () => {
    const read = timed(() => spec.isUnique?.({ sealed: true, bottleNumber: `#${" ".repeat(200_000)}x` } as never));
    expect(read.value).toBe(false);
    expect(read.ms).toBeLessThan(BUDGET_MS);
  });

  it("still tells a bottle from a batch the way a label writes them", () => {
    for (const bottle of ["Bottle 123/2000", "123 of 2000", "No. 123/2000", "no 5 of 50", "#7/100", "  bottle   12  OF  300  "]) expect(isBottleNumber(bottle), bottle).toBe(true);
    for (const batch of ["Batch 12", "L2023", "Bottle", "12", "123/", "of 2000", "Bottle 12 of", ""]) expect(isBottleNumber(batch), batch).toBe(false);
    expect(isBottleNumber(null)).toBe(false);
  });

  it("reads exactly what the pattern it replaced read, on short strings drawn from the characters that matter", () => {
    const before = (text: string) => /^\s*(?:bottle|no\.?|#)?\s*\d+\s*(?:\/|of)\s*\d+\s*$/i.test(text);
    const breaks = ["\n", "\r", "\r\n", "\u2028", "\u2029"];
    const inputs = [
      ...drawn(["bottle", "Bottle", "no", "no.", "No.", "#", "1", "12", "/", "of", "OF", "x", " ", "  ", "\t", "\u00a0", ...breaks], 30_000, 21),
      ...drawn(["1", "12", "/", "of", " ", "  ", "\t", ...breaks], 20_000, 22).map((rest) => `bottle${rest}`),
    ];
    // Reaching the cases that matter: a good many are bottle numbers, and a good many are not.
    expect(inputs.filter((text) => isBottleNumber(text)).length).toBeGreaterThan(300);
    expect(inputs.filter((text) => !isBottleNumber(text)).length).toBeGreaterThan(500);
    expect(inputs.filter((text) => isBottleNumber(text) !== before(text)).slice(0, 5)).toEqual([]);
  });
});
