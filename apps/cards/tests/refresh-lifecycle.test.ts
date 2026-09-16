import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDb, openDatabase, setDb } from "@/lib/db";
import { createCard, deleteCard, latestSnapshot } from "@/lib/cards";
import { refreshAll, refreshRunning } from "@/lib/pricing/refresh";
import * as pricing from "@/lib/pricing";
import { restoreBackup } from "@/lib/backup";
import { archiveGate } from "@/lib/storage";
import { priceJobs } from "@/lib/price-jobs";
import type { PriceOutcome } from "@collectcollect/core/price-jobs";
import type { PriceSummary } from "@/lib/types";
import { holdingsHistory, initializeHoldingsHistory } from "@collectcollect/core/holdings-history";

const summary: PriceSummary = { currency: "USD", fetchedAt: new Date().toISOString(), ungraded: 10, ungradedSource: "Fixture", graded: {}, gradedSource: null,
  estimatedGraded: {}, yourCopyValue: 10, yourCopyBasis: "Fixture", quotes: [], errors: [] };
beforeEach(() => setDb(openDatabase(":memory:")));
afterEach(() => { vi.restoreAllMocks(); closeDatabase(); });

describe("refresh lifecycle", () => {
  it("does not save a delayed quote against a deleted holding, and excludes restores while working", async () => {
    const card = createCard({ game: "other", name: "Being priced" });
    let release!: (summary: PriceSummary) => void;
    vi.spyOn(pricing, "priceCard").mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const outcomes: PriceOutcome[] = [];
    const work = refreshAll({ ids: [card.id], onProgress: (outcome) => outcomes.push(outcome) });
    expect(refreshRunning()).toBe(true);
    await expect(restoreBackup(new Uint8Array())).rejects.toThrow(/current price refresh/);
    deleteCard(card.id); release(summary);
    expect(await work).toMatchObject({ refreshed: 0, skipped: 1 });
    expect(outcomes).toEqual([{ id: card.id, status: "skipped", message: "Card was removed or sold out during refresh." }]);
    expect(latestSnapshot(card.id)).toBeNull();
    expect(refreshRunning()).toBe(false);
  });

  it("refuses a persistent refresh before creating a job during archive maintenance", async () => {
    createCard({ game: "other", name: "Waiting", manualUngraded: 10 });
    await archiveGate.run(async () => {
      expect(() => priceJobs.start()).toThrow(/already running/);
      expect(getDb().prepare("SELECT COUNT(*) AS n FROM price_jobs").get()).toEqual({ n: 0 });
    });
  });

  it("starts legacy history at its actual opening balance, without an invented zero-value period", () => {
    const db = getDb();
    for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'history_%'").all() as Array<{ name: string }>) db.exec(`DROP TRIGGER "${row.name}"`);
    db.prepare("DELETE FROM settings WHERE key='holdings_history_started'").run();
    db.exec("DELETE FROM holdings_events");
    const card = createCard({ game: "other", name: "Existing holding", quantity: 2 });
    db.prepare("INSERT INTO price_snapshots(card_id,fetched_at,summary) VALUES(?,?,?)").run(card.id, summary.fetchedAt, JSON.stringify(summary));
    initializeHoldingsHistory(db, { table: "cards", foreignKey: "card_id", name: "name", rawField: "ungraded" });
    const history = holdingsHistory(db);
    expect(history.points).toEqual([{ t: history.startedAt, value: 20, ungraded: 20, priced: 1, unpriced: 0 }]);
  });
});
