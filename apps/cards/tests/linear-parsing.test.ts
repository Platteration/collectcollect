import { describe, expect, it } from "vitest";
import { parseCardMarkdown } from "@/lib/markdown/card";
import { goalRecord } from "@/lib/goals/markdown";
import { looksLikeOneRatio, parseCentering, parseSide } from "@/lib/grading/centering";
import { readCentering } from "@/lib/grading/schema";
import { caveatSentence } from "@/lib/format";
import { readLotPart, splitSource } from "@collectcollect/core/markdown/format";

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

/**
 * Short strings drawn from a few tokens by a seeded generator (mulberry32), so
 * a failure names an input that comes back on every run, and short enough that
 * the patterns the scans replaced stay quick on every one of them.
 */
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

/** The inputs on which a reader and the pattern it replaced disagree, the first few. */
function disagreements<T>(inputs: string[], read: (text: string) => T, before: (text: string) => T): string[] {
  return inputs.filter((text) => JSON.stringify(read(text)) !== JSON.stringify(before(text))).slice(0, 5);
}

describe("the scans read exactly what the patterns they replaced read", () => {
  // Every kind of line break, since the patterns' `.` stopped at each and their `\s` did not.
  const breaks = ["\n", "\r", "\r\n", "\u2028", "\u2029"];
  const spacing = [" ", "  ", "\t", "\u00a0", ...breaks];

  it("for a purchase-lot cell's parts", () => {
    const before = (part: string) => {
      const match = /^\s*(\d+)\s*@\s*(.*?)\s*(?:\((\d{4}-\d{2}-\d{2})\))?\s*$/.exec(part);
      return match ? { quantity: match[1] ?? "", cost: match[2] ?? "", day: match[3] ?? null } : null;
    };
    const parts = [
      "2 @ $1.50 (2026-03-01)",
      "2 @ $1.\n50 (2026-03-01)",
      "2 @ $1.50\n(2026-03-01)",
      "2 @ $1.50 (2026-03-01)\u2028",
      "2 @ x (2026-03-01) (2026-03-01)",
      ...drawn(["2", "12", "@", "$1.50", "x", "(", ")", "(2026-03-01)", "2026-03-01", ...spacing], 10_000, 7),
      // Half of them starting the way a part does, so most get as far as the cost and the day.
      ...drawn(["$1.50", "x", "(", ")", "(2026-03-01)", "2026-03-01", "@", ...spacing], 10_000, 8).map((rest) => `2 @${rest}`),
    ];
    // Reaching the cases that matter: parts that read, with and without a day, and costs a break splits.
    expect(parts.filter((part) => before(part)?.day).length).toBeGreaterThan(100);
    expect(parts.filter((part) => before(part) && !before(part)?.day).length).toBeGreaterThan(100);
    expect(parts.filter((part) => /\d\s*@.*\S[\n\r\u2028\u2029]+\S/.test(part.trim()) && !before(part)).length).toBeGreaterThan(100);
    expect(disagreements(parts, readLotPart, before)).toEqual([]);
  });

  it("for a value and the source it names in brackets", () => {
    const before = (text: string) => {
      const match = /^(.*?)\s*\((.*)\)\s*$/.exec(text.trim());
      if (!match) return { rest: text.trim(), source: null };
      const [, rest = "", source = ""] = match;
      return { rest: rest.trim(), source: source.trim() || null };
    };
    const cells = [
      "$8.00 (Scryfall (TCGplayer-derived USD))",
      "$8.00\n(Scryfall)",
      "$8\r.00 (Scryfall)",
      "$8.00 (Scry\u2029fall)",
      ...drawn(["$8.00", "Scryfall", "(", ")", "(Scryfall)", "x", ...spacing], 20_000, 11),
    ];
    expect(cells.filter((cell) => before(cell).source).length).toBeGreaterThan(500);
    expect(cells.filter((cell) => /[\n\r\u2028\u2029]/.test(cell.trim()) && before(cell).source === null && cell.trim().endsWith(")")).length).toBeGreaterThan(100);
    expect(disagreements(cells, splitSource, before)).toEqual([]);
  });

  it("for a goal file's record and a stored caveat", () => {
    const recordBefore = (text: string) => text.match(/(?:^|\n)```json\r?\n([\s\S]*?)\r?\n```(?:\r?\n|$)/)?.[1];
    const files = drawn(["```json\n", "```json\r\n", "\n```\n", "\n```\r\n", "\n```", "```json", "```", "\n", "\r\n", "\r", "{}", "x", " "], 20_000, 13, 10);
    expect(files.filter((text) => recordBefore(text) !== undefined).length).toBeGreaterThan(200);
    expect(disagreements(files, goalRecord, recordBefore)).toEqual([]);
    const caveats = drawn(["glare", ".", ";", ",", "!", ...spacing], 20_000, 17);
    expect(disagreements(caveats, caveatSentence, (caveat) => caveat.replace(/[.;,]?\s*$/, ""))).toEqual([]);
  });
});
