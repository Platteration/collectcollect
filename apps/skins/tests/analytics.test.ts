import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { addSnapshot, allSnapshots, costBasisByItem, latestSnapshotsByItem, listItems } from "@/lib/items";
import { allocationBy, change, portfolioSeries, realizedReturn, sliceRange, totalReturn } from "@/lib/analytics";
import { valueOf } from "@/lib/valuation";
import type { ItemRecord, PriceSummary } from "@/lib/types";
import { seedCase, seedRedline } from "./helpers";

beforeEach(() => setDb(openDatabase(":memory:")));

function priced(at: string, value: number): PriceSummary {
  return {
    currency: "USD",
    fetchedAt: at,
    market: value,
    marketSource: "Skinport",
    yourCopyValue: value,
    yourCopyBasis: "Skinport lowest ask",
    quotes: [],
    errors: [],
  };
}

describe("value over time", () => {
  it("totals every item at the price it last had", () => {
    const rifle = seedRedline();
    const cases = seedCase({ quantity: 10 });
    addSnapshot(rifle.id, priced("2026-01-01T00:00:00.000Z", 40));
    addSnapshot(cases.id, priced("2026-02-01T00:00:00.000Z", 1));
    addSnapshot(rifle.id, priced("2026-03-01T00:00:00.000Z", 55));
    const points = portfolioSeries(listItems(), allSnapshots());
    expect(points.map((p) => p.value)).toEqual([40, 50, 65]);
    expect(points[2]?.priced).toBe(2);
  });

  it("ignores an item that has since been deleted", () => {
    const cases = seedCase({ quantity: 1 });
    addSnapshot(cases.id, priced("2026-01-01T00:00:00.000Z", 5));
    expect(portfolioSeries([], allSnapshots())).toEqual([]);
  });

  it("collapses a refresh that priced everything in the same instant", () => {
    const a = seedCase({ quantity: 1 });
    const b = seedCase({ marketHashName: "Chroma Case", quantity: 1 });
    addSnapshot(a.id, priced("2026-01-01T00:00:00.000Z", 2));
    addSnapshot(b.id, priced("2026-01-01T00:00:00.000Z", 3));
    const points = portfolioSeries(listItems(), allSnapshots());
    expect(points).toHaveLength(1);
    expect(points[0]?.value).toBe(5);
  });
});

describe("ranges", () => {
  const points = [
    { t: "2026-01-01T00:00:00.000Z", value: 10 },
    { t: "2026-06-01T00:00:00.000Z", value: 20 },
    { t: "2026-06-25T00:00:00.000Z", value: 30 },
  ];
  const now = Date.parse("2026-07-01T00:00:00.000Z");

  it("keeps the point before the window so the line has somewhere to start", () => {
    // A week back reaches only the last point, so the one before it comes too:
    // a line starting at its own first value would show no change at all.
    expect(sliceRange(points, "1W", now).map((p) => p.value)).toEqual([20, 30]);
  });

  it("keeps everything when the window reaches past the oldest point", () => {
    expect(sliceRange(points, "1M", now).map((p) => p.value)).toEqual([10, 20, 30]);
    expect(sliceRange(points, "ALL", now)).toEqual(points);
  });

  it("falls back to the last value when every point predates the window", () => {
    const later = Date.parse("2027-01-01T00:00:00.000Z");
    expect(sliceRange(points, "1W", later).map((p) => p.value)).toEqual([30]);
  });

  it("measures change from the start of what is shown", () => {
    expect(change(sliceRange(points, "1W", now))).toMatchObject({ amount: 10, percent: 50 });
    expect(change(sliceRange(points, "1M", now))).toMatchObject({ amount: 20, percent: 200 });
    expect(change(points.slice(0, 1))).toMatchObject({ amount: 0, percent: null });
  });
});

describe("return", () => {
  it("counts only the copies whose cost is known, on both sides", () => {
    const known = seedCase({ quantity: 2, purchasePrice: 1 });
    const unknown = seedCase({ marketHashName: "Chroma Case", quantity: 5 });
    addSnapshot(known.id, priced("2026-01-01T00:00:00.000Z", 3));
    addSnapshot(unknown.id, priced("2026-01-01T00:00:00.000Z", 3));
    const latest = latestSnapshotsByItem();
    const basis = costBasisByItem();
    const returns = totalReturn(listItems(), (i) => valueOf(i, latest.get(i.id)).value, (i) => basis.get(i.id));
    // Two dollars in, six out. The five free copies are counted separately
    // rather than valued at nothing, which would read as pure profit.
    expect(returns).toMatchObject({ invested: 2, valueOfInvested: 6, amount: 4, percent: 200, copiesWithoutCost: 5 });
  });

  it("sets aside an item bought but not yet priced", () => {
    const item = seedCase({ quantity: 1, purchasePrice: 5 });
    const basis = costBasisByItem();
    const returns = totalReturn([item], () => null, (i) => basis.get(i.id));
    expect(returns).toMatchObject({ invested: 0, itemsWithCost: 0, itemsAwaitingPrice: 1 });
  });

  it("does not claim a percentage against nothing", () => {
    expect(realizedReturn([{ quantity: 1, unitPrice: 5, fees: 0, unitCost: null }])).toMatchObject({
      gain: 5,
      percent: null,
      withoutCost: 1,
    });
  });
});

describe("allocation", () => {
  it("measures shares against the whole inventory, not against the rows shown", () => {
    // A case has no rarity. Sharing only across the items that do have one
    // would say the knife is 100% of the inventory when it is two thirds.
    const knife = seedRedline({ marketHashName: "★ Karambit | Doppler (Factory New)", category: "knife", rarity: "extraordinary" });
    const cases = seedCase({ quantity: 1, rarity: null });
    addSnapshot(knife.id, priced("2026-01-01T00:00:00.000Z", 200));
    addSnapshot(cases.id, priced("2026-01-01T00:00:00.000Z", 100));
    const latest = latestSnapshotsByItem();
    const price = (i: ItemRecord) => valueOf(i, latest.get(i.id)).value;

    const byRarity = allocationBy(listItems(), (i) => i.rarity, price);
    expect(byRarity.rows).toHaveLength(1);
    expect(byRarity.rows[0]?.share).toBeCloseTo(2 / 3, 10);
    expect(byRarity.unclassified).toBe(100);
    expect(byRarity.unclassifiedShare).toBeCloseTo(1 / 3, 10);

    // Every item has a kind, so that grouping does account for the whole.
    const byCategory = allocationBy(listItems(), (i) => i.category, price);
    expect(byCategory.unclassified).toBe(0);
    expect(byCategory.rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1, 10);
  });

  it("counts every copy of a stack", () => {
    const cases = seedCase({ quantity: 4 });
    addSnapshot(cases.id, priced("2026-01-01T00:00:00.000Z", 2.5));
    const latest = latestSnapshotsByItem();
    const split = allocationBy(listItems(), (i) => i.category, (i) => valueOf(i, latest.get(i.id)).value);
    expect(split.rows[0]?.value).toBe(10);
  });

  it("has nothing to show for an empty inventory", () => {
    expect(allocationBy([], (i) => i.category, () => 1)).toEqual({ rows: [], unclassified: 0, unclassifiedShare: 0 });
  });
});

describe("valuation", () => {
  it("lets a price typed in by hand beat the market", () => {
    const item = seedCase({ quantity: 1, manualPrice: 12 });
    addSnapshot(item.id, priced("2026-01-01T00:00:00.000Z", 3));
    expect(valueOf(item, latestSnapshotsByItem().get(item.id))).toEqual({ value: 12, basis: "Your own price" });
  });

  it("says an unpriced item is unpriced rather than guessing", () => {
    const item = seedCase({ quantity: 1 });
    expect(valueOf(item, undefined)).toEqual({ value: null, basis: "Not priced yet" });
  });
});
