import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { spec } from "@/lib/spec";
import { fakeFetch } from "./helpers";

const sub = { brand: "Rolex", model: "Submariner", referenceNumber: "124060" } as const;

describe("pricing a watch", () => {
  it("has a manual-entry source and nothing else, and says so", () => {
    expect(spec.pricing.providers.map((p) => p.id)).toEqual(["manual"]);
    const statuses = engine.statuses();
    expect(statuses.find((s) => s.id === "manual")).toMatchObject({ configured: true });
    expect(statuses.find((s) => s.id === "manual")?.note).toMatch(/Type what each watch is worth/);
  });

  it("values a watch at what the owner said, and a refresh changes nothing", async () => {
    const watch = engine.repo.createItem({ ...sub, purchasePrice: 9100 });
    expect(engine.valuation(watch, null)).toEqual({ value: null, basis: "Not priced yet" });
    const priced = engine.repo.updateItem(watch.id, { manualValue: 12300 })!;
    expect(engine.valuation(priced, null)).toEqual({ value: 12300, basis: "Your own price" });
    const fetchImpl = fakeFetch([]);
    const outcome = await engine.refresh.refreshItem(priced, fetchImpl);
    expect(outcome.stored).toBe(true);
    expect(outcome.snapshot.summary).toMatchObject({ yourCopyValue: 12300, yourCopyBasis: "Your own price", market: null });
    expect(fetchImpl.calls).toEqual([]);
  });

  it("draws the chart from values entered by hand with dates, in date order", () => {
    const watch = engine.repo.createItem(sub);
    engine.refresh.addManualSnapshot(watch.id, { value: 11800, at: "2025-01-15", note: "Chrono24 median" });
    engine.refresh.addManualSnapshot(watch.id, { value: 12800, at: "2025-09-01" });
    engine.refresh.addManualSnapshot(watch.id, { value: 12300, at: "2026-03-01" });
    const history = engine.repo.listSnapshots(watch.id);
    expect(history.map((s) => s.summary.yourCopyValue)).toEqual([12300, 12800, 11800]);
    expect(history[0].summary.yourCopyBasis).toBe("Entered by hand");
    expect(history[2].summary.yourCopyBasis).toBe("Chrono24 median");
    expect(engine.valuation(watch, history[0])).toEqual({ value: 12300, basis: "Entered by hand" });
    expect(() => engine.refresh.addManualSnapshot(watch.id, { value: "lots" })).toThrow(/number/);
  });

  it("raises a price-move alert when a hand-entered value moves enough", async () => {
    const watch = engine.repo.createItem({ ...sub, manualValue: 10000 });
    await engine.refresh.refreshItem(watch, fakeFetch([]));
    const moved = engine.repo.updateItem(watch.id, { manualValue: 12000 })!;
    await engine.refresh.refreshItem(moved, fakeFetch([]));
    const alerts = engine.alerts.listAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "price_move", itemId: watch.id });
    expect(alerts[0].title).toMatch(/Rolex Submariner up 20.0%/);
  });
});
