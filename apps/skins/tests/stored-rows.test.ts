import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { addSnapshot, latestSnapshotsByItem, listSnapshots } from "@/lib/items";
import { summarize } from "@/lib/pricing";
import { readPriceSummary } from "@/lib/price-summary";
import { spreadView } from "@/lib/spread";
import { valueOf } from "@/lib/valuation";
import { DEFAULT_SETTINGS, type PriceQuote } from "@/lib/types";
import { GET as exportCsv } from "@/app/api/export/route";
import { seedCase } from "./helpers";

/**
 * Price snapshots a restore installs from a file this app never wrote. Each
 * shape below was put into a backup, restored through the real route, and
 * left the "Where to sell" page answering 500 on every load.
 */
beforeEach(() => setDb(openDatabase(":memory:")));

function insertSnapshot(itemId: number, summary: string, at: string) {
  getDb().prepare("INSERT INTO price_snapshots (item_id, fetched_at, summary) VALUES (?, ?, ?)").run(itemId, at, summary);
}

const quote = (over: Partial<PriceQuote>): PriceQuote => ({
  source: "skinport",
  sourceLabel: "Skinport",
  currency: "USD",
  url: "https://skinport.com/item/x",
  matchedName: "Clutch Case",
  price: 1.2,
  volume: null,
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("a price snapshot this app did not write", () => {
  it("leaves the spread, the values and the export readable", async () => {
    for (const summary of ["{}", '{"yourCopyValue":5}', '{"yourCopyValue":5,"quotes":[1,null,{"source":"toString","price":3},{"source":"skinport","price":"x"},{"source":"csfloat","price":4}],"errors":5}']) {
      const item = seedCase({ quantity: 1 });
      insertSnapshot(item.id, summary, "2026-01-01T00:00:00.000Z");
    }
    const latest = latestSnapshotsByItem();
    expect([...latest.values()].map((s) => s.summary.quotes.map((q) => [q.source, q.price]))).toEqual([[], [], [["skinport", null], ["csfloat", 4]]]);
    expect(() => spreadView(DEFAULT_SETTINGS)).not.toThrow();
    const res = await exportCsv(new Request("http://localhost/api/export"));
    expect(res.status).toBe(200);
  });

  it("drops one that is not an object at all, where every page used to read through it", () => {
    const item = seedCase({ quantity: 1 });
    for (const summary of ["null", "1", "[]", '"x"']) insertSnapshot(item.id, summary, "2026-01-01T00:00:00.000Z");
    expect(listSnapshots(item.id)).toEqual([]);
    expect(latestSnapshotsByItem().get(item.id)).toBeUndefined();
    expect(valueOf({ ...item, manualPrice: null }, latestSnapshotsByItem().get(item.id))).toEqual({ value: null, basis: "Not priced yet" });
    expect(() => spreadView(DEFAULT_SETTINGS)).not.toThrow();
  });

  it("reads a summary this app wrote back exactly as it was written", () => {
    const item = seedCase({ quantity: 1 });
    const written = summarize(
      { manualPrice: 2 },
      [quote({}), quote({ source: "csfloat", sourceLabel: "CSFloat", price: 1.15, volume: 12 }), quote({ source: "steam", sourceLabel: "Steam", price: 1.4 })],
      [{ source: "steam", message: "Steam answered 429" }],
      DEFAULT_SETTINGS,
      "2026-02-01T00:00:00.000Z",
    );
    expect(written.valueBasis).toBe("manual");
    const stored = JSON.parse(JSON.stringify(written));
    expect(readPriceSummary(stored, "2026-02-01T00:00:00.000Z")).toEqual(stored);
    addSnapshot(item.id, written);
    expect(listSnapshots(item.id)[0]?.summary).toEqual(stored);
  });
});
