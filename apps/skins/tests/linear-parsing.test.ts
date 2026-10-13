import { describe, expect, it } from "vitest";
import { parseItemMarkdown } from "@/lib/markdown/item";
import { exteriorFromName, guessCategory, splitName } from "@/lib/naming";
import { previewImport } from "@/lib/import";

/**
 * Text the app did not write — a spreadsheet's name column, an item file read
 * back in — is read in time proportional to its length. Each input below is
 * one the pattern it replaced took seconds over while the server answered
 * nothing else; the budget is far above what a scan of it costs and far below
 * what those patterns did.
 */
const BUDGET_MS = 1000;

function timed<T>(read: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = read();
  return { value, ms: performance.now() - started };
}

const spaces = (n: number) => " ".repeat(n);

describe("reading a name", () => {
  it("reads a name of a hundred thousand brackets in linear time", () => {
    // Sixty thousand "(" in one spreadsheet cell held the whole server for
    // eleven seconds, and the file may be 8 MB.
    const hostile = "(".repeat(100_000);
    const wear = timed(() => [exteriorFromName(hostile), guessCategory(`${hostile} x`)] as const);
    expect(wear.value).toEqual([null, null]);
    expect(wear.ms).toBeLessThan(BUDGET_MS);
    const gun = timed(() => splitName(`AK-47 | ${hostile}`));
    expect(gun.value).toEqual({ weapon: "AK-47", finish: hostile });
    expect(gun.ms).toBeLessThan(BUDGET_MS);
    expect(splitName(`AK-47 | ${hostile})`)).toEqual({ weapon: "AK-47", finish: null });
    const preview = timed(() => previewImport(`name,category\n${hostile},weapon\n`));
    expect(preview.value.rows[0]?.input?.exterior).toBeNull();
    expect(preview.ms).toBeLessThan(BUDGET_MS);
  });

  it("still reads the wear tier and the gun out of a real name", () => {
    expect(exteriorFromName("StatTrak™ AK-47 | Redline (Field-Tested)  ")).toBe("field_tested");
    expect(exteriorFromName("AK-47 | Redline ((Minimal Wear)")).toBe("minimal_wear");
    expect(exteriorFromName("AK-47 | Redline (Field-Tested) x")).toBeNull();
    expect(exteriorFromName("AK-47 | Redline ()")).toBeNull();
    expect(splitName("StatTrak™ AK-47 | Redline (Field-Tested)")).toEqual({ weapon: "AK-47", finish: "Redline" });
    expect(splitName("★ Karambit | Doppler  ()  ")).toEqual({ weapon: "Karambit", finish: "Doppler" });
    expect(splitName("Sticker | Titan (Holo) | Katowice 2014")).toEqual({ weapon: "Sticker", finish: "Titan (Holo) | Katowice 2014" });
  });
});

describe("reading an item file back in", () => {
  const file = (rows: { market?: string; markets?: string; lots?: string }) =>
    [
      "---",
      'market_hash_name: "Clutch Case"',
      'category: "case"',
      "quantity: 1",
      "---",
      "",
      "# Clutch Case",
      "",
      "## Value history",
      "",
      "| Date | Your copy | Market | Basis | Markets |",
      "| --- | --- | --- | --- | --- |",
      `| 2026-03-01T00:00:00.000Z | $9.00 | ${rows.market ?? "$9.00 (Skinport)"} | Skinport | ${rows.markets ?? "Skinport $1.20 · CSFloat $4.15"} |`,
      "",
      "## Sales",
      "",
      "| Sold | Copies | Each | Fees | Cost each | Venue | Notes | Lots |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      `| 2026-03-02T00:00:00.000Z | 1 | $20.00 | $1.00 | $5.00 | Skinport | — | ${rows.lots ?? "1 @ $5.00 (2026-01-01)"} |`,
      "",
    ].join("\n");

  it("reads a markets cell of tens of thousands of spaces in linear time", () => {
    const run = timed(() => parseItemMarkdown(file({ markets: `Skinport $1.20 · a b${spaces(100_000)}c · CSFloat $4.15` })));
    expect(run.value?.snapshots[0]?.summary.quotes.map((q) => [q.source, q.price])).toEqual([["skinport", 1.2], ["csfloat", 4.15]]);
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });

  it("reads a sale's lot cell and a market cell of hostile text in linear time", () => {
    // Two thousand spaces in a lot cell took four seconds; the time grew with
    // the cube of the length.
    const run = timed(() => parseItemMarkdown(file({ lots: `1 @ a${spaces(3000)}x · 2 @ $3.00 (2026-01-05)`, market: "(".repeat(64_000) })));
    expect(run.value?.sales[0]?.lots).toEqual([
      { quantity: 1, unitCost: null, acquiredOn: null },
      { quantity: 2, unitCost: 3, acquiredOn: "2026-01-05" },
    ]);
    expect(run.value?.snapshots[0]?.summary.marketSource).toBeNull();
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });

  it("still reads the cells it always read", () => {
    const parsed = parseItemMarkdown(file({}));
    expect(parsed?.snapshots[0]?.summary).toMatchObject({ market: 9, marketSource: "Skinport" });
    expect(parsed?.snapshots[0]?.summary.quotes.map((q) => [q.source, q.price])).toEqual([["skinport", 1.2], ["csfloat", 4.15]]);
    expect(parsed?.sales[0]?.lots).toEqual([{ quantity: 1, unitCost: 5, acquiredOn: "2026-01-01" }]);
  });
});
