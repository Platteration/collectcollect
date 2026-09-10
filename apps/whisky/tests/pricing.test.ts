import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { spec } from "@/lib/spec";
import { fakeFetch } from "./helpers";

describe("pricing a bottle", () => {
  it("has a manual-entry source and nothing else", () => {
    expect(spec.pricing.providers.map((p) => p.id)).toEqual(["manual"]);
    expect(engine.statuses().find((s) => s.id === "manual")?.note).toMatch(/hammer prices/);
  });

  it("values a sealed bottle at what the owner said, and draws the chart from dated entries", async () => {
    const bottle = engine.repo.createItem({ distillery: "Yamazaki", expression: "12 Year Old", ageStatement: 12 });
    engine.refresh.addManualSnapshot(bottle.id, { value: 260, at: "2025-03-01", note: "Whisky Auctioneer hammer" });
    engine.refresh.addManualSnapshot(bottle.id, { value: 300, at: "2026-03-01" });
    expect(engine.repo.listSnapshots(bottle.id).map((s) => s.summary.yourCopyValue)).toEqual([300, 260]);
    expect(engine.valuation(bottle, engine.repo.latestSnapshot(bottle.id))).toEqual({ value: 300, basis: "Entered by hand" });
    const fetchImpl = fakeFetch([]);
    const outcome = await engine.refresh.refreshItem(bottle, fetchImpl);
    expect(outcome.stored).toBe(false);
    expect(fetchImpl.calls).toEqual([]);
    expect(engine.repo.listSnapshots(bottle.id)).toHaveLength(2);
  });
});
