import { beforeEach, describe, expect, it } from "vitest";
import { allocationBy, change, portfolioSeries, realizedReturn, sliceRange, totalReturn } from "../src/domain/analytics";
import { widgetEngine } from "./widgets";

let engine: ReturnType<typeof widgetEngine>;
beforeEach(() => {
  engine = widgetEngine();
});

const priced = (at: string, value: number) => ({ currency: "USD" as const, fetchedAt: at, yourCopyValue: value, yourCopyBasis: "t", quotes: [], errors: [], market: value, marketSource: "t" });

describe("value over time", () => {
  it("totals every item at the price it last had", () => {
    const a = engine.repo.createItem({ name: "A" });
    const b = engine.repo.createItem({ name: "B", quantity: 10 });
    engine.repo.addSnapshot(a.id, priced("2026-01-01T00:00:00.000Z", 40));
    engine.repo.addSnapshot(b.id, priced("2026-02-01T00:00:00.000Z", 1));
    engine.repo.addSnapshot(a.id, priced("2026-03-01T00:00:00.000Z", 55));
    const points = portfolioSeries(engine.repo.listItems(), engine.repo.allSnapshots());
    expect(points.map((p) => p.value)).toEqual([40, 50, 65]);
  });

  it("slices a range and measures the change from its first visible point", () => {
    const points = [
      { t: "2026-01-01T00:00:00.000Z", value: 10 },
      { t: "2026-06-01T00:00:00.000Z", value: 20 },
      { t: "2026-06-25T00:00:00.000Z", value: 30 },
    ];
    const now = Date.parse("2026-07-01T00:00:00.000Z");
    expect(sliceRange(points, "1W", now).map((p) => p.value)).toEqual([20, 30]);
    expect(change(sliceRange(points, "1W", now))).toMatchObject({ amount: 10, percent: 50 });
    expect(change([points[0]])).toMatchObject({ amount: 0, percent: null });
  });
});

describe("returns and allocation", () => {
  it("counts only copies whose cost is known, on both sides", () => {
    const known = engine.repo.createItem({ name: "K", quantity: 2, purchasePrice: 1 });
    const unknown = engine.repo.createItem({ name: "U", quantity: 5 });
    engine.repo.addSnapshot(known.id, priced("2026-01-01T00:00:00.000Z", 3));
    engine.repo.addSnapshot(unknown.id, priced("2026-01-01T00:00:00.000Z", 3));
    const latest = engine.repo.latestSnapshotsByItem();
    const basis = engine.ledger.costBasisByItem();
    const returns = totalReturn(engine.repo.listItems(), (i) => engine.valuation(i, latest.get(i.id)).value, (i) => basis.get(i.id));
    expect(returns).toMatchObject({ invested: 2, valueOfInvested: 6, amount: 4, percent: 200, copiesWithoutCost: 5 });
    expect(realizedReturn([{ quantity: 1, unitPrice: 5, fees: 0, unitCost: null }])).toMatchObject({ gain: 5, percent: null, withoutCost: 1 });
  });

  it("measures shares against the whole collection, naming what is unclassified", () => {
    const a = engine.repo.createItem({ name: "A", kind: "gizmo" });
    const b = engine.repo.createItem({ name: "B" });
    engine.repo.addSnapshot(a.id, priced("2026-01-01T00:00:00.000Z", 200));
    engine.repo.addSnapshot(b.id, priced("2026-01-01T00:00:00.000Z", 100));
    const latest = engine.repo.latestSnapshotsByItem();
    const split = allocationBy(engine.repo.listItems(), (i) => i.kind, (i) => engine.valuation(i, latest.get(i.id)).value);
    expect(split.rows).toEqual([{ key: "gizmo", value: 200, items: 1, share: 2 / 3 }]);
    expect(split.unclassified).toBe(100);
  });
});
