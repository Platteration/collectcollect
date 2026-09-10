import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/domain/engine";
import { widgetEngine, widgetSpec } from "./widgets";

let engine: ReturnType<typeof widgetEngine>;
beforeEach(() => {
  engine = widgetEngine();
});

describe("normalising what a client sends", () => {
  it("insists on the required field and refuses unknown enum values", () => {
    expect(() => engine.repo.createItem({ name: "  " })).toThrow(/Name is required/);
    expect(() => engine.repo.createItem({ name: "x", kind: "spaceship" as never })).toThrow(/Unknown kind/);
    expect(() => engine.repo.createItem({ name: "x", kind: "constructor" as never })).toThrow(/Unknown kind/);
  });

  it("coerces each field by its type", () => {
    const w = engine.repo.createItem({
      name: " Gizmo One ",
      year: "1999" as never,
      weight: "1,234.5" as never,
      signed: "yes" as never,
      boughtOn: "2026-03-04",
      tags: "a; b|c" as never,
      history: [{ date: "2026-01-01", note: "serviced" }],
      quantity: "3" as never,
    });
    expect(w).toMatchObject({ name: "Gizmo One", year: 1999, weight: 1234.5, signed: true, tags: ["a", "b", "c"], quantity: 3 });
    expect(w.boughtOn).toMatch(/^2026-03-04T/);
    expect(w.history).toEqual([{ date: "2026-01-01", note: "serviced" }]);
  });

  it("refuses a number below a field's floor and a bad date", () => {
    expect(() => engine.repo.createItem({ name: "x", year: 12 })).toThrow(/at least 1800/);
    expect(() => engine.repo.createItem({ name: "x", boughtOn: "not a date" })).toThrow(/valid date/);
  });

  it("caps a unique object at one copy", () => {
    expect(engine.repo.createItem({ name: "x", serial: "S1", quantity: 3 }).quantity).toBe(1);
    expect(engine.repo.createItem({ name: "x", quantity: 3 }).quantity).toBe(3);
  });

  it("stores only photo names it would have written and http image urls", () => {
    const w = engine.repo.createItem({ name: "x", photos: ["../etc/passwd", "11111111-2222-4333-8444-555555555555.jpg"], referenceImageUrl: "javascript:alert(1)" });
    expect(w.photos).toEqual(["11111111-2222-4333-8444-555555555555.jpg"]);
    expect(w.referenceImageUrl).toBeNull();
  });
});

describe("the ledger under every item", () => {
  it("opens a purchase lot for the copies an item brings in", () => {
    const w = engine.repo.createItem({ name: "x", quantity: 4, purchasePrice: 2.5 });
    expect(engine.ledger.listLots(w.id)).toMatchObject([{ quantity: 4, remaining: 4, unitCost: 2.5 }]);
    expect(engine.ledger.verifyLotInvariant()).toEqual([]);
  });

  it("keeps purchases apart and averages what is held", () => {
    const w = engine.repo.createItem({ name: "x", quantity: 1, purchasePrice: 1 });
    engine.repo.addAcquisition(w.id, { quantity: 3, unitCost: 5 });
    const held = engine.repo.getItem(w.id)!;
    expect(held.quantity).toBe(4);
    expect(held.purchasePrice).toBeCloseTo(4, 10);
    expect(engine.ledger.listLots(w.id).map((l) => l.unitCost)).toEqual([1, 5]);
  });

  it("refuses a second copy of a unique object", () => {
    const w = engine.repo.createItem({ name: "x", serial: "S1" });
    expect(() => engine.repo.addAcquisition(w.id, { quantity: 1 })).toThrow(/separate widget/);
  });

  it("reconciles the lots when the count is typed in directly", () => {
    const w = engine.repo.createItem({ name: "x", quantity: 5, purchasePrice: 1 });
    engine.repo.updateItem(w.id, { quantity: 8 });
    expect(engine.ledger.verifyLotInvariant()).toEqual([]);
    expect(engine.ledger.listLots(w.id).find((l) => l.unitCost === null)?.remaining).toBe(3);
  });
});

describe("intake: unique versus fungible", () => {
  it("merges a fungible copy into the stack that matches on every identity key", () => {
    engine.repo.createItem({ name: "Gadget", maker: "Acme", kind: "gadget", quantity: 2, purchasePrice: 1 });
    const outcome = engine.repo.intakeItem({ name: "gadget", maker: "ACME", kind: "gadget", quantity: 3, purchasePrice: 2 });
    expect(outcome.result).toBe("merged");
    expect(engine.repo.listItems()).toHaveLength(1);
    const item = engine.repo.listItems()[0];
    expect(item.quantity).toBe(5);
    expect(engine.ledger.listLots(item.id).map((l) => l.unitCost)).toEqual([1, 2]);
  });

  it("creates a new row when an identity key differs", () => {
    engine.repo.createItem({ name: "Gadget", maker: "Acme", kind: "gadget" });
    expect(engine.repo.intakeItem({ name: "Gadget", maker: "Other", kind: "gadget" }).result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(2);
  });

  it("never merges a unique object, and never merges into one", () => {
    engine.repo.createItem({ name: "Gadget", maker: "Acme", serial: "S1" });
    expect(engine.repo.intakeItem({ name: "Gadget", maker: "Acme", serial: "S2" }).result).toBe("created");
    expect(engine.repo.intakeItem({ name: "Gadget", maker: "Acme" }).result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(3);
  });

  it("stops rather than guessing when several stacks match", () => {
    engine.repo.createItem({ name: "Gadget" });
    engine.repo.createItem({ name: "Gadget" });
    expect(engine.repo.intakeItem({ name: "Gadget" }).result).toBe("ambiguous");
  });

  it("adopts the photo when the stack has none", () => {
    engine.repo.createItem({ name: "Gadget" });
    const merged = engine.repo.intakeItem({ name: "Gadget", photos: ["11111111-2222-4333-8444-555555555555.jpg"], accentColor: "#abcdef" });
    if (merged.result !== "merged") throw new Error("expected a merge");
    expect(merged.item).toMatchObject({ photos: ["11111111-2222-4333-8444-555555555555.jpg"], accentColor: "#abcdef", quantity: 2 });
  });
});

describe("listing", () => {
  it("searches the title and searchable fields for the characters typed", () => {
    engine.repo.createItem({ name: "Alpha", maker: "Zed Works", notes: "50% off" });
    engine.repo.createItem({ name: "Beta" });
    expect(engine.repo.listItems({ search: "zed" }).map((i) => i.name)).toEqual(["Alpha"]);
    expect(engine.repo.listItems({ search: "50%" }).map((i) => i.name)).toEqual(["Alpha"]);
    expect(engine.repo.listItems({ search: "_" })).toHaveLength(0);
  });

  it("filters by enum and boolean fields and by location", () => {
    engine.repo.createItem({ name: "A", kind: "gizmo", signed: true, location: "Shelf 1" });
    engine.repo.createItem({ name: "B", kind: "gadget", location: "Shelf 2" });
    engine.repo.createItem({ name: "C" });
    expect(engine.repo.listItems({ filters: { kind: "gizmo" } }).map((i) => i.name)).toEqual(["A"]);
    expect(engine.repo.listItems({ filters: { signed: true } }).map((i) => i.name)).toEqual(["A"]);
    expect(engine.repo.listItems({ location: "" }).map((i) => i.name)).toEqual(["C"]);
    expect(engine.repo.listLocations()).toEqual([
      { location: "Shelf 1", items: 1 },
      { location: "Shelf 2", items: 1 },
    ]);
  });

  it("returns items saved in the same tick in a settled order", () => {
    const a = engine.repo.createItem({ name: "A" });
    const b = engine.repo.createItem({ name: "B" });
    engine.db.getDb().prepare("UPDATE items SET updated_at = ?").run("2026-01-01T00:00:00.000Z");
    expect(engine.repo.listItems().map((i) => i.id)).toEqual([b.id, a.id]);
  });
});

describe("sales", () => {
  it("takes the oldest copies first, books the gain, and can be undone", () => {
    const w = engine.repo.createItem({ name: "x", quantity: 2, purchasePrice: 1 });
    engine.repo.addAcquisition(w.id, { quantity: 2, unitCost: 4 });
    const sale = engine.sales.recordSale(w.id, { quantity: 3, unitPrice: 10, venue: "eBay" });
    expect(engine.ledger.listSaleLots(sale.id).map((l) => [l.quantity, l.unitCost])).toEqual([
      [2, 1],
      [1, 4],
    ]);
    expect(sale.unitCost).toBe(2);
    expect(engine.repo.getItem(w.id)!.quantity).toBe(1);
    expect(engine.sales.listSales()[0]).toMatchObject({ itemName: "x", venue: "eBay" });
    expect(engine.sales.deleteSale(sale.id)).toBe(true);
    expect(engine.repo.getItem(w.id)!.quantity).toBe(4);
    expect(engine.ledger.verifyLotInvariant()).toEqual([]);
  });

  it("refuses a free sale by accident", () => {
    const w = engine.repo.createItem({ name: "x", quantity: 1 });
    expect(() => engine.sales.recordSale(w.id, { unitPrice: null as never })).toThrow(/price is required/);
    expect(() => engine.sales.recordSale(w.id, { quantity: 2, unitPrice: 1 })).toThrow(/only have 1/);
  });
});

describe("the database on disk", () => {
  it("adds a column for a field the spec gained after the database was made", () => {
    const file = `${engine.db.dataDir()}/old.db`;
    const older = widgetSpec();
    older.fields = older.fields.filter((f) => f.key !== "weight");
    createEngine(older).db.openDatabase(file).close();
    const fresh = createEngine(widgetSpec());
    const db = fresh.db.openDatabase(file);
    const cols = (db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("weight");
    db.close();
    fs.rmSync(file, { force: true });
  });
});
