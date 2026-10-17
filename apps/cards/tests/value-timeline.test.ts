import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValueChart } from "@collectcollect/core/components/ValueChart";
import { holdingsHistory, holdingsLedger } from "@collectcollect/core/holdings-history";
import { PortfolioChart } from "@/components/charts/PortfolioChart";
import { addAcquisition, addSnapshot, createCard, deleteCard, latestSnapshotsByCard, updateCard } from "@/lib/cards";
import { costBasisByCard, costRatesByCard } from "@/lib/acquisitions";
import { closeDatabase, getDb, openDatabase, setDb } from "@/lib/db";
import { recordSale, deleteSale } from "@/lib/sales";
import { totalReturn, valueTimeline, type PortfolioPoint } from "@/lib/analytics";
import { listCards } from "@/lib/cards";
import type { PriceSummary } from "@/lib/types";

const price = (n: number | null): PriceSummary => ({ currency: "USD", fetchedAt: new Date().toISOString(), ungraded: n, ungradedSource: "Fixture", graded: {}, gradedSource: null,
  estimatedGraded: {}, yourCopyValue: n, yourCopyBasis: "Fixture", quotes: [], errors: [] });

beforeEach(() => setDb(openDatabase(":memory:")));
afterEach(() => { closeDatabase(); setDb(undefined); });

/** The timeline as the dashboard builds it. */
const timeline = () => {
  const rates = costRatesByCard();
  return valueTimeline(holdingsLedger(getDb()), (id) => rates.get(id));
};

describe("the timeline is the recorded history, with more on each point", () => {
  it("agrees with the totals of the holdings history through purchases, prices, sales, undo, corrections and deletes", () => {
    const first = createCard({ name: "First", game: "other", quantity: 2, purchasePrice: 4 });
    addSnapshot(first.id, price(10));
    addSnapshot(first.id, price(12));
    const second = createCard({ name: "Second", game: "other" });
    addAcquisition(second.id, { quantity: 3, unitCost: 2 });
    addSnapshot(second.id, price(5));
    const sale = recordSale(first.id, { quantity: 1, unitPrice: 15 });
    deleteSale(sale.id);
    updateCard(first.id, { quantity: 3 });
    addSnapshot(second.id, price(null));
    deleteCard(second.id);
    const totals = (p: { t: string; value: number; ungraded: number; priced: number; unpriced: number }) => ({ t: p.t, value: p.value, ungraded: p.ungraded, priced: p.priced, unpriced: p.unpriced });
    const recorded = holdingsHistory(getDb()).points;
    expect(timeline().map(totals)).toEqual(recorded);
    expect(recorded.at(-1)).toMatchObject({ value: 36 });
  });

  it("adds what the copies held cost, and what moved in, to the last point", () => {
    const card = createCard({ name: "Bought", game: "other", quantity: 2, purchasePrice: 5 });
    addSnapshot(card.id, price(10));
    addSnapshot(card.id, price(12));
    recordSale(card.id, { quantity: 1, unitPrice: 14 });
    // 2 copies priced at 10 came in (20); they were repriced to 12 (+4, the market); one copy left at 12.
    expect(timeline().at(-1)).toMatchObject({ value: 12, copies: 1, cost: 5, costedValue: 12, flows: 8 });
  });

  it("ends on the gain the dashboard reports as unrealized, over the same copies", () => {
    const priced = createCard({ name: "Priced", game: "other", quantity: 3, purchasePrice: 5 });
    addSnapshot(priced.id, price(9));
    recordSale(priced.id, { quantity: 1, unitPrice: 9 });
    // A card with no cost, and one with a cost but no price yet: neither is in the return, nor in the cost line.
    addSnapshot(createCard({ name: "Gift", game: "other" }).id, price(100));
    createCard({ name: "Awaiting", game: "other", purchasePrice: 50 });
    const last = timeline().at(-1);
    const latest = latestSnapshotsByCard();
    const cards = listCards().filter((c) => c.quantity > 0);
    const basis = costBasisByCard();
    const returns = totalReturn(cards, (c) => latest.get(c.id)?.summary.yourCopyValue ?? null, (c) => basis.get(c.id));
    expect(returns.amount).toBe(8);
    expect(last).toMatchObject({ cost: 10, costedValue: 18, value: 118 });
    expect((last?.costedValue ?? 0) - (last?.cost ?? 0)).toBe(returns.amount);
  });

  it("dates a purchase or a sale to the moment it was entered, whatever date was typed", () => {
    const card = createCard({ name: "Backdated", game: "other", quantity: 2 });
    addSnapshot(card.id, price(10));
    recordSale(card.id, { quantity: 1, unitPrice: 9, soldAt: "2020-01-01T00:00:00.000Z" });
    const { events } = holdingsLedger(getDb());
    expect(events.every((e) => e.recordedAt > "2026")).toBe(true);
    expect(timeline().at(-1)).toMatchObject({ value: 10, copies: 1 });
  });
});

describe("what a card's copies cost, for the history", () => {
  it("is the average over the copies held, counting every copy that was bought with a cost", () => {
    const card = createCard({ name: "Two lots", game: "other", quantity: 2, purchasePrice: 10 });
    addAcquisition(card.id, { quantity: 2, unitCost: 30 });
    expect(costRatesByCard().get(card.id)).toEqual({ unitCost: 20, copies: 4 });
    // The oldest copies go first, so what is held is dearer than what was bought on average.
    recordSale(card.id, { quantity: 2, unitPrice: 25 });
    expect(costRatesByCard().get(card.id)).toEqual({ unitCost: 30, copies: 4 });
  });

  it("is kept for a card sold down to nothing, so its past can still be drawn", () => {
    const card = createCard({ name: "Gone", game: "other", quantity: 2, purchasePrice: 7 });
    recordSale(card.id, { quantity: 2, unitPrice: 9 });
    expect(costRatesByCard().get(card.id)).toEqual({ unitCost: 7, copies: 2 });
  });

  it("leaves out copies that arrived with no cost, and cards that have none at all", () => {
    const mixed = createCard({ name: "Mixed", game: "other", quantity: 1, purchasePrice: 8 });
    addAcquisition(mixed.id, { quantity: 3, unitCost: null });
    createCard({ name: "Gift", game: "other", quantity: 2 });
    expect([...costRatesByCard()]).toEqual([[mixed.id, { unitCost: 8, copies: 1 }]]);
  });

  it("reads a lot a restore left unreadable as no cost, not as a cost of nothing or NaN", () => {
    const card = createCard({ name: "Restored", game: "other", quantity: 1, purchasePrice: 8 });
    const db = getDb();
    const lot = db.prepare("SELECT id FROM acquisitions WHERE card_id = ?").get(card.id) as { id: number };
    db.prepare("UPDATE acquisitions SET quantity = 0, remaining = 0 WHERE id = ?").run(lot.id);
    expect(costRatesByCard().has(card.id)).toBe(false);
    db.prepare("UPDATE acquisitions SET quantity = 10, remaining = 10, unit_cost = 1e308 WHERE id = ?").run(lot.id);
    expect(costRatesByCard().has(card.id)).toBe(false);
    // A lot of a negative number of copies would make a negative cost.
    db.prepare("UPDATE acquisitions SET quantity = -3, remaining = -3, unit_cost = 8 WHERE id = ?").run(lot.id);
    expect(costRatesByCard().has(card.id)).toBe(false);
  });
});

describe("the record read back", () => {
  it("leaves out a row a restore made unreadable, and reads a price that is not a number as no price", () => {
    const card = createCard({ name: "Kept", game: "other", quantity: 2 });
    addSnapshot(card.id, price(10));
    const db = getDb();
    const insert = db.prepare("INSERT INTO holdings_events(entity_id,name,kind,recorded_at,quantity,unit_value,raw_unit_value) VALUES(?,?,?,?,?,?,?)");
    insert.run(card.id, "x", "price", "not a date", 2, 99, 99);
    insert.run(card.id, "x", "price", "2030-01-01T00:00:00.000Z", -3, 99, 99);
    insert.run(card.id, "x", "price", "2030-01-02T00:00:00.000Z", 2, "cheap", "dear");
    const events = holdingsLedger(db).events;
    expect(events.some((e) => e.recordedAt === "not a date" || e.quantity < 0)).toBe(false);
    expect(events.at(-1)).toMatchObject({ recordedAt: "2030-01-02T00:00:00.000Z", quantity: 2, unitValue: null, rawUnitValue: null });
    const last = timeline().at(-1);
    expect(Number.isFinite(last?.value)).toBe(true);
    expect(last).toMatchObject({ value: 0, priced: 0, unpriced: 1 });
  });
});

describe("the chart", () => {
  const base = (d: number, over: Partial<PortfolioPoint> = {}): PortfolioPoint => ({ t: new Date(Date.UTC(2026, 5, 1 + d)).toISOString(), value: 14900 + d * 200, ungraded: 0, priced: 1, ...over });
  const points = [base(0, { cost: 12000, costedValue: 14900 }), base(1, { cost: 12000, costedValue: 15100 }), base(2, { cost: 12400, costedValue: 15300 })];
  const draw = (extra: Partial<Parameters<typeof PortfolioChart>[0]> = {}) => renderToStaticMarkup(createElement(PortfolioChart, { points, up: true, ...extra }));

  it("fits the axis to the data and marks where the window opened, rather than starting at zero", () => {
    const html = draw({ showCost: true });
    expect(html).toContain('data-series="opening"');
    expect(html).toContain(">$12.0K<"); // the cost line is in frame, so the scale takes it in
    expect(html).not.toContain(">$0<");
  });

  it("draws the cost as a dashed line in a chart series colour, behind the value line, and says so to a screen reader", () => {
    const html = draw({ showCost: true });
    const basis = /<path data-series="basis"[^>]*>/.exec(html)?.[0] ?? "";
    expect(basis).toContain('stroke="var(--chart-series-1)"');
    expect(basis).toContain('stroke-dasharray="5 4"');
    expect(html.indexOf('data-series="basis"')).toBeLessThan(html.indexOf('stroke="var(--chart-good)"'));
    expect(html).toContain("cost basis $12,400");
  });

  it("draws no cost line unless asked, or where the cost is nothing", () => {
    expect(draw()).not.toContain('data-series="basis"');
    expect(draw({ showCost: true, points: points.map((p) => ({ ...p, cost: 0 })) })).not.toContain('data-series="basis"');
    // Only the middle of the series has a cost: one run, not a line dropping to zero at either end.
    const gap = [points[0]!, { ...points[1]!, cost: 12000 }, points[2]!].map((p, i) => (i === 1 ? p : { ...p, cost: 0 }));
    const html = draw({ showCost: true, points: gap });
    expect(html.match(/data-series="basis"/g)).toHaveLength(1);
    expect(html).toContain("<circle data-series=\"basis\"");
  });

  it("is unchanged for a chart that asks for neither: the axis from zero, and no rule", () => {
    const html = renderToStaticMarkup(createElement(ValueChart, { points, up: true, label: "Plain" }));
    expect(html).toContain(">$0<");
    expect(html).not.toContain('data-series="opening"');
    expect(html).not.toContain('data-series="basis"');
  });

  it("spells gridlines out when a narrow range would repeat the compact form", () => {
    const narrow = [base(0, { value: 15000 }), base(1, { value: 15012 })];
    const html = renderToStaticMarkup(createElement(PortfolioChart, { points: narrow, up: true }));
    expect(html).toContain(">$15,005<");
    expect(html).not.toContain(">$15.0K<");
  });

  it("gives a card's own chart a paid line", () => {
    const own = [base(0, { value: 40, cost: 25 }), base(1, { value: 55, cost: 25 })];
    const html = renderToStaticMarkup(createElement(PortfolioChart, { points: own, up: true, showCost: true, costLabel: "paid", label: "Value of this card over time" }));
    expect(html).toContain("paid $25.00");
    expect(html).toContain('data-series="basis"');
  });
});
