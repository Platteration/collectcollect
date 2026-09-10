import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { openBottle } from "@/lib/open";
import { fakeFetch } from "./helpers";

const springbank = { distillery: "Springbank", expression: "10 Year Old", ageStatement: 10, abv: 46, region: "campbeltown", packaging: "box" } as const;

describe("opening a bottle", () => {
  it("takes one copy off a sealed stack, with the oldest copy's cost, frozen at the stack's value", () => {
    const stack = engine.repo.createItem({ ...springbank, quantity: 1, purchasePrice: 60 });
    engine.repo.addAcquisition(stack.id, { quantity: 2, unitCost: 90 });
    engine.refresh.addManualSnapshot(stack.id, { value: 140, at: "2026-01-10" });

    const opened = openBottle(engine, stack.id);
    expect(opened.id).not.toBe(stack.id);
    expect(opened).toMatchObject({ sealed: false, quantity: 1, fillLevel: 100, frozenValue: 140, purchasePrice: 60, distillery: "Springbank", expression: "10 Year Old" });
    expect(opened.openedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The opened bottle starts its own history at the value it took with it.
    expect(engine.repo.latestSnapshot(opened.id)?.summary.yourCopyValue).toBe(140);
    expect(engine.valuation(opened, engine.repo.latestSnapshot(opened.id))).toEqual({ value: 140, basis: `Frozen when opened on ${opened.openedAt}` });
    expect(engine.counts(opened)).toBe(false);

    const rest = engine.repo.getItem(stack.id)!;
    expect(rest).toMatchObject({ sealed: true, quantity: 2, purchasePrice: 90 });
    expect(engine.ledger.listLots(stack.id).map((l) => l.remaining)).toEqual([0, 2]);
    expect(engine.ledger.verifyLotInvariant()).toEqual([]);
    expect(engine.counts(rest)).toBe(true);
    expect(engine.valuation(rest, engine.repo.latestSnapshot(stack.id)).value).toBe(140);
  });

  it("opens the only copy in place", () => {
    const one = engine.repo.createItem({ ...springbank, purchasePrice: 60, manualValue: 150 });
    const opened = openBottle(engine, one.id, { fillLevel: 95, at: "2026-02-02" });
    expect(opened.id).toBe(one.id);
    expect(opened).toMatchObject({ sealed: false, openedAt: "2026-02-02", fillLevel: 95, frozenValue: 150, quantity: 1 });
    expect(engine.repo.listItems()).toHaveLength(1);
    expect(() => openBottle(engine, one.id)).toThrow(/already open/);
  });

  it("freezes the value when 'sealed' is switched off in an ordinary edit, and thaws it if that was a mistake", async () => {
    const bottle = engine.repo.createItem({ ...springbank, manualValue: 120 });
    await engine.refresh.refreshItem(bottle, fakeFetch([]));
    const opened = engine.repo.updateItem(bottle.id, { sealed: false })!;
    expect(opened).toMatchObject({ sealed: false, frozenValue: 120, fillLevel: 100 });
    expect(opened.openedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Drinking it changes the fill, not the value.
    const drunk = engine.repo.updateItem(bottle.id, { fillLevel: 40, manualValue: 500 })!;
    expect(engine.valuation(drunk, engine.repo.latestSnapshot(bottle.id))).toMatchObject({ value: 120 });
    const resealed = engine.repo.updateItem(bottle.id, { sealed: true })!;
    expect(resealed).toMatchObject({ sealed: true, frozenValue: null, openedAt: null, fillLevel: null });
    expect(engine.valuation(resealed, engine.repo.latestSnapshot(bottle.id)).value).toBe(500);
  });

  it("carries no value when opened before it was ever valued", () => {
    const bottle = engine.repo.createItem(springbank);
    const opened = openBottle(engine, bottle.id);
    expect(opened.frozenValue).toBeNull();
    expect(engine.valuation(opened, null)).toEqual({ value: null, basis: "Opened before it was ever valued" });
  });

  it("keeps an open bottle out of the portfolio total but in the collection and on the report", () => {
    const stack = engine.repo.createItem({ ...springbank, quantity: 2, manualValue: 100 });
    openBottle(engine, stack.id);
    const items = engine.repo.listItems();
    expect(items).toHaveLength(2);
    const total = items.filter((b) => engine.counts(b)).reduce((n, b) => n + (engine.valuation(b, null).value ?? 0) * b.quantity, 0);
    expect(total).toBe(100);
    expect(engine.exportCsv().split("\n").filter((l) => l.includes("Springbank"))).toHaveLength(2);
  });
});
