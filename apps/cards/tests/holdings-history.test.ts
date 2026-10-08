import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb, getDb, closeDatabase } from "@/lib/db";
import { createCard, updateCard, addSnapshot, deleteCard, latestSnapshot, latestSnapshotsByCard, markChecked } from "@/lib/cards";
import { recordSale, deleteSale } from "@/lib/sales";
import { verifyLotInvariant } from "@/lib/acquisitions";
import { holdingsHistory } from "@collectcollect/core/holdings-history";
import type { PriceSummary } from "@/lib/types";

const price = (n: number): PriceSummary => ({ currency: "USD", fetchedAt: new Date().toISOString(), ungraded: n,
  ungradedSource: "Fixture", graded: {}, gradedSource: null, estimatedGraded: {}, yourCopyValue: n,
  yourCopyBasis: "Fixture", quotes: [], errors: [] });
beforeEach(() => setDb(openDatabase(":memory:")));
afterEach(() => { closeDatabase(); setDb(undefined); });
describe("recorded holdings history", () => {
  it("agrees with collection and detail values when historical prices arrive out of order", () => {
    const card = createCard({ name: "Imported history", game: "other", quantity: 2 });
    addSnapshot(card.id, { ...price(20), fetchedAt: "2026-09-15T12:00:00Z" });
    addSnapshot(card.id, { ...price(8), fetchedAt: "2026-01-01T12:00:00Z" });
    expect(latestSnapshotsByCard().get(card.id)).toEqual(latestSnapshot(card.id));
    expect(holdingsHistory(getDb()).points.at(-1)?.value).toBe(40);
    addSnapshot(card.id, { ...price(0), fetchedAt: "2026-09-15T12:00:00Z" });
    expect(latestSnapshotsByCard().get(card.id)?.summary.yourCopyValue).toBe(0);
    expect(holdingsHistory(getDb()).points.at(-1)).toMatchObject({ value: 0, priced: 1, unpriced: 0 });
  });
  it("keeps the earlier holding after a sale, undo and quantity correction", () => {
    const card = createCard({ name: "History", game: "other", quantity: 2, purchasePrice: 4 });
    addSnapshot(card.id, price(10));
    const before = getDb().prepare("SELECT * FROM holdings_events ORDER BY id").all();
    expect(holdingsHistory(getDb()).points.at(-1)?.value).toBe(20);
    const sale = recordSale(card.id, { quantity: 1, unitPrice: 12 });
    expect(holdingsHistory(getDb()).points.at(-1)?.value).toBe(10);
    expect(getDb().prepare("SELECT * FROM holdings_events ORDER BY id LIMIT ?").all(before.length)).toEqual(before);
    deleteSale(sale.id);
    expect(holdingsHistory(getDb()).points.at(-1)?.value).toBe(20);
    updateCard(card.id, { quantity: 3 });
    expect(holdingsHistory(getDb()).points.at(-1)?.value).toBe(30);
    expect(getDb().prepare("SELECT kind FROM holdings_events WHERE kind IN ('sale','sale_reversal')").all()).toEqual([{ kind: "sale" }, { kind: "sale_reversal" }]);
    expect(verifyLotInvariant()).toEqual([]);
  });
  it("preserves deleted holdings and marks unpriced holdings without inventing prices", () => {
    const card = createCard({ name: "Kept in history", game: "other" });
    expect(holdingsHistory(getDb()).points.at(-1)?.unpriced).toBe(1);
    addSnapshot(card.id, price(8));
    deleteCard(card.id);
    expect(holdingsHistory(getDb()).points.at(-1)).toMatchObject({ value: 0, unpriced: 0 });
    expect(getDb().prepare("SELECT unit_value FROM holdings_events WHERE kind='price'").get()).toEqual({ unit_value: 8 });
  });
  it("rolls history back with a failed transaction", () => {
    const before = getDb().prepare("SELECT COUNT(*) AS n FROM holdings_events").get();
    expect(() => getDb().transaction(() => { createCard({ name: "Rollback", game: "other" }); throw new Error("stop"); })()).toThrow("stop");
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM holdings_events").get()).toEqual(before);
  });
});

describe("a latest snapshot revalued in place", () => {
  it("is a price point, while a bookkeeping change on the row and an older snapshot revalued are nothing", () => {
    const card = createCard({ name: "Revalued", game: "other", quantity: 1 });
    addSnapshot(card.id, { ...price(10), fetchedAt: "2026-01-01T00:00:00Z" });
    const latest = latestSnapshot(card.id)!;
    const events = () => getDb().prepare("SELECT kind, unit_value FROM holdings_events WHERE entity_id = ? ORDER BY id").all(card.id) as Array<{ kind: string; unit_value: number | null }>;
    const before = events().length;
    getDb().prepare("UPDATE price_snapshots SET summary = ? WHERE id = ?").run(JSON.stringify({ ...latest.summary, yourCopyValue: 25 }), latest.id);
    expect(events().at(-1)).toMatchObject({ kind: "price", unit_value: 25 });
    expect(holdingsHistory(getDb()).points.at(-1)?.value).toBe(25);
    getDb().prepare("UPDATE price_snapshots SET fetched_at = fetched_at WHERE id = ?").run(latest.id);
    expect(events()).toHaveLength(before + 1);
    addSnapshot(card.id, { ...price(30), fetchedAt: "2026-02-01T00:00:00Z" });
    const n = events().length;
    getDb().prepare("UPDATE price_snapshots SET summary = ? WHERE id = ?").run(JSON.stringify({ ...latest.summary, yourCopyValue: 99 }), latest.id);
    expect(events()).toHaveLength(n);
    expect(holdingsHistory(getDb()).points.at(-1)?.value).toBe(30);
  });
  it("records nothing for a check that found the same prices", () => {
    const card = createCard({ name: "Steady", game: "other", quantity: 1 });
    const snapshot = addSnapshot(card.id, price(10));
    const events = getDb().prepare("SELECT * FROM holdings_events ORDER BY id").all();
    markChecked(snapshot.id, new Date().toISOString());
    expect(getDb().prepare("SELECT * FROM holdings_events ORDER BY id").all()).toEqual(events);
    expect(latestSnapshot(card.id)?.checkedAt).toBeDefined();
  });
});
