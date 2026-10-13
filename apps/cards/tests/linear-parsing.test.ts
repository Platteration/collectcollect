import { describe, expect, it } from "vitest";
import { parseCardMarkdown } from "@/lib/markdown/card";
import { goalRecord } from "@/lib/goals/markdown";
import { looksLikeOneRatio, parseCentering, parseSide } from "@/lib/grading/centering";
import { readCentering } from "@/lib/grading/schema";
import { caveatSentence } from "@/lib/format";

/**
 * Text the app did not write — a card file read back in, a request's
 * centering field, a stored caveat — is read in time proportional to its
 * length. Each input below is one the pattern it replaced took seconds over, or
 * minutes, and the server answers nothing else while one runs; the budget is
 * far above what a scan of it costs and far below what those patterns did.
 */
const BUDGET_MS = 1000;

function timed<T>(read: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = read();
  return { value, ms: performance.now() - started };
}

const spaces = (n: number) => " ".repeat(n);

describe("reading centering", () => {
  it("gives up on a long run of spaces at once", () => {
    // Two hundred spaces after "55": nine seconds with the space slots side by
    // side, and each doubling of the run multiplied that by about twenty-five.
    const hostile = `55${spaces(200)}x`;
    const run = timed(() => [looksLikeOneRatio(hostile), () => parseSide(hostile)] as const);
    expect(run.value[0]).toBe(false);
    expect(run.value[1]).toThrow(/two numbers that add up to 100/);
    expect(run.ms).toBeLessThan(BUDGET_MS);
    const field = timed(() => () => readCentering({ front: { lr: hostile, tb: null }, back: null }));
    expect(field.value).toThrow(/two numbers that add up to 100/);
    expect(field.ms).toBeLessThan(BUDGET_MS);
  });

  it("still reads ratios written with any spacing", () => {
    expect(looksLikeOneRatio("55 /\t 45")).toBe(true);
    expect(parseSide("54L/46R    49T/51B")).toEqual({ lr: [54, 46], tb: [49, 51] });
    expect(readCentering({ front: { lr: "55  45", tb: null }, back: null })).toEqual({ front: { lr: [55, 45], tb: null }, back: { lr: null, tb: null } });
  });

  it("reads the vision model's prose in linear time", () => {
    const run = timed(() => parseCentering(`about 55${spaces(64_000)}x left-right, 60/40 top-bottom`));
    expect(run.value).toEqual({ front: { lr: null, tb: [60, 40] }, back: { lr: null, tb: null } });
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });
});

describe("reading a card file back in", () => {
  const file = (rows: { graded?: string; ungraded?: string; lots?: string }) =>
    [
      "---",
      'name: "Bolt"',
      'game: "mtg"',
      "---",
      "",
      "# Bolt",
      "",
      "## Value history",
      "",
      "| Date | Your copy | Ungraded | Graded | Basis |",
      "| --- | --- | --- | --- | --- |",
      `| 2026-02-02T10:00:00.000Z | $8.00 | ${rows.ungraded ?? "$8.00 (Scryfall)"} | ${rows.graded ?? "PSA 10 $200.00 (PriceCharting)"} | Ungraded. |`,
      "",
      "## Sales",
      "",
      "| Sold | Copies | Each | Fees | Cost each | Venue | Notes | Lots |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      `| 2026-03-01T10:00:00.000Z | 1 | $20.00 | $1.00 | $5.00 | eBay | — | ${rows.lots ?? "1 @ $5.00 (2026-01-01)"} |`,
      "",
    ].join("\n");

  it("reads a grade cell of tens of thousands of spaces in linear time", () => {
    // Sixty thousand of them held the server for ten seconds.
    const run = timed(() => parseCardMarkdown(file({ graded: `PSA 10 $200.00 · a${spaces(64_000)}x · PSA 9 $50.00` })));
    expect(run.value?.snapshots[0]?.summary.graded).toEqual({ "PSA 10": 200, "PSA 9": 50 });
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });

  it("reads a sale's lot cell of spaces in linear time", () => {
    // Two thousand spaces took four seconds; the time grew with the cube of the length.
    const run = timed(() => parseCardMarkdown(file({ lots: `1 @ a${spaces(3000)}x · 2 @ $3.00 (2026-01-05)` })));
    expect(run.value?.sales[0]?.lots).toEqual([
      { quantity: 1, unitCost: null, acquiredOn: null },
      { quantity: 2, unitCost: 3, acquiredOn: "2026-01-05" },
    ]);
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });

  it("reads a price cell of brackets in linear time", () => {
    const run = timed(() => parseCardMarkdown(file({ ungraded: "(".repeat(64_000) })));
    expect(run.value?.snapshots[0]?.summary.ungradedSource).toBeNull();
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });

  it("still reads the cells it always read", () => {
    const parsed = parseCardMarkdown(file({}));
    expect(parsed?.snapshots[0]?.summary).toMatchObject({ ungraded: 8, ungradedSource: "Scryfall", graded: { "PSA 10": 200 }, gradedSource: "PriceCharting" });
    expect(parsed?.sales[0]?.lots).toEqual([{ quantity: 1, unitCost: 5, acquiredOn: "2026-01-01" }]);
  });
});

describe("reading a goal file back in", () => {
  it("finds the record past any number of fences that never close", () => {
    // 144 KB of openings took more than a second, 360 KB ten, and a folder may be 64 MB.
    const run = timed(() => goalRecord("\n```json\n".repeat(40_000)));
    expect(run.value).toBeUndefined();
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });

  it("reads the record between the first fence and its closing", () => {
    expect(goalRecord("# Goal\n\n```json\n{\"a\":1}\n```\n")).toBe('{"a":1}');
    expect(goalRecord("# Goal\r\n\r\n```json\r\n{\"a\":1}\r\n```")).toBe('{"a":1}');
    expect(goalRecord("```json\n{}\n```x\n```\nafter")).toBe("{}\n```x");
    expect(goalRecord("x```json\n{}\n```\n")).toBeUndefined();
  });
});

describe("a stored caveat", () => {
  it("loses its closing punctuation and spaces in linear time", () => {
    const run = timed(() => caveatSentence(`Glare on the holo${spaces(64_000)}x`));
    expect(run.value).toBe(`Glare on the holo${spaces(64_000)}x`);
    expect(run.ms).toBeLessThan(BUDGET_MS);
    expect(caveatSentence("Glare on the holo.  ")).toBe("Glare on the holo");
    expect(caveatSentence("Only the front; ")).toBe("Only the front");
    expect(caveatSentence("Sleeve in the way")).toBe("Sleeve in the way");
  });
});
