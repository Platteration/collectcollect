import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readTable } from "../src/markdown/format";
import { parseItemMarkdown } from "../src/domain/markdown/document";
import { widgetEngine, widgetSpec, type Widget } from "./widgets";

/**
 * An item file read back in is text the app did not write, up to the
 * import's 64 MB, and parsing runs on the one thread every request shares.
 * The sale's lot cell used to be read with a pattern whose lazy part sat
 * between two runs of spaces, which took seconds over a few thousand spaces
 * and minutes over a few hundred thousand characters. The card app's own file
 * reader (apps/cards/tests/linear-parsing.test.ts) holds the same cell to the
 * same budget; the budget here is far above what a scan costs and far below
 * what that pattern did.
 */
const BUDGET_MS = 1000;

let engine: ReturnType<typeof widgetEngine>;
beforeEach(() => {
  engine = widgetEngine();
});

const spec = widgetSpec();

/** A real item file with one sale, its lot cell replaced by `cell`. */
function fileWithLotCell(cell: string): string {
  const w = engine.repo.createItem({ name: "Gizmo", quantity: 2, purchasePrice: 10 });
  engine.sales.recordSale(w.id, { quantity: 1, unitPrice: 25, fees: 1, venue: "eBay" });
  engine.mirror.flushCollection();
  const dir = engine.mirror.itemsDir();
  const name = fs.readdirSync(dir).find((f) => f.startsWith(String(w.id).padStart(4, "0")))!;
  const text = fs.readFileSync(path.join(dir, name), "utf8");
  const written = readTable(text, "Sales")[0]![7]!;
  expect(written).toContain("1 @ $10.00");
  const [head, tail] = text.split("## Sales") as [string, string];
  return `${head}## Sales${tail.replace(written, cell)}`;
}

const lotsOf = (cell: string) => parseItemMarkdown<Widget>(spec, fileWithLotCell(cell))?.sales[0]?.lots;

describe("reading a sale's lot cell", () => {
  it("reads a cell of thousands of spaces in linear time, and the parts around it as they were", () => {
    // Two thousand spaces took four seconds; the time grew with the cube of the length.
    const file = fileWithLotCell(`1 @ a${" ".repeat(2500)}x · 2 @ $3.00 (2026-01-05)`);
    const started = performance.now();
    const parsed = parseItemMarkdown<Widget>(spec, file);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    expect(parsed?.sales[0]?.lots).toEqual([
      { quantity: 1, unitCost: null, acquiredOn: null },
      { quantity: 2, unitCost: 3, acquiredOn: "2026-01-05" },
    ]);
  });

  it("still reads the cells it always read", () => {
    expect(lotsOf("1 @ $5.00 (2026-01-01)")).toEqual([{ quantity: 1, unitCost: 5, acquiredOn: "2026-01-01" }]);
    expect(lotsOf("2 @ $1.50 · 3 @ — (2026-03-01)")).toEqual([
      { quantity: 2, unitCost: 1.5, acquiredOn: null },
      { quantity: 3, unitCost: null, acquiredOn: "2026-03-01" },
    ]);
    // Spacing around a part is free, a part that is not a lot is skipped, and so is a lot of none.
    expect(lotsOf("  4  @  $2.00 (2026-01-02)  · nonsense · 0 @ $1.00")).toEqual([{ quantity: 4, unitCost: 2, acquiredOn: "2026-01-02" }]);
    // A day with spaces inside its brackets is not a day, and what is left is not a price.
    expect(lotsOf("4 @ $2.00 ( 2026-01-02 )")).toEqual([{ quantity: 4, unitCost: null, acquiredOn: null }]);
  });
});
