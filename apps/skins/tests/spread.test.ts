import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { addSnapshot } from "@/lib/items";
import { saveSettings } from "@/lib/settings";
import { spreadView } from "@/lib/spread";
import { DEFAULT_SETTINGS, type PriceQuote, type PriceSummary } from "@/lib/types";
import { seedCase, seedRedline } from "./helpers";

beforeEach(() => setDb(openDatabase(":memory:")));

function quote(source: PriceQuote["source"], price: number): PriceQuote {
  const labels = { skinport: "Skinport", steam: "Steam Community Market", csfloat: "CSFloat", manual: "Your own price" };
  return { source, sourceLabel: labels[source], currency: "USD", url: null, matchedName: "", price, volume: null, fetchedAt: "x" };
}

function priced(id: number, value: number, quotes: PriceQuote[]) {
  const summary: PriceSummary = {
    currency: "USD",
    fetchedAt: "2026-06-01T00:00:00.000Z",
    market: value,
    marketSource: "Skinport",
    yourCopyValue: value,
    yourCopyBasis: "Skinport listing",
    quotes,
    errors: [],
  };
  addSnapshot(id, summary);
}

describe("the spread view", () => {
  it("compares only the markets that pay money", () => {
    const item = seedRedline();
    // Steam lists highest and nets the most, and is still not the answer.
    priced(item.id, 100, [quote("steam", 500), quote("skinport", 100), quote("csfloat", 95)]);
    const [row] = spreadView().worthDoing;
    expect(row.cash.map((c) => c.market)).toEqual(["csfloat", "skinport"]);
    expect(row.wallet.map((c) => c.market)).toEqual(["steam"]);
    // 95 × 0.98 = 93.10 against 100 × 0.88 = 88.00.
    expect(row.gap).toBe(5.1);
  });

  it("has nothing to say when only one market is listing something", () => {
    const item = seedRedline();
    priced(item.id, 100, [quote("skinport", 100)]);
    const view = spreadView();
    expect(view.worthDoing).toEqual([]);
    expect(view.slim).toEqual([]);
    // Counted, not dropped: "nothing to compare" is a different answer from
    // "no difference".
    expect(view.noComparison).toBe(1);
  });

  it("does not invent a comparison out of Steam alone", () => {
    const item = seedRedline();
    priced(item.id, 100, [quote("steam", 500), quote("skinport", 100)]);
    expect(spreadView().noComparison).toBe(1);
  });

  it("counts what nothing has priced separately from what nothing can compare", () => {
    seedRedline();
    const priced1 = seedRedline({ floatValue: 0.3 });
    priced(priced1.id, 10, [quote("skinport", 10)]);
    const view = spreadView();
    expect(view.unpriced).toBe(1);
    expect(view.noComparison).toBe(1);
  });

  it("judges a stack on what the whole holding is worth moving", () => {
    saveSettings({ ...DEFAULT_SETTINGS, spreadMinAmount: 1, spreadMinPercent: 5 });
    const cases = seedCase({ quantity: 35 });
    priced(cases.id, 1.4, [quote("skinport", 1.4), quote("csfloat", 1.35)]);
    const [row] = spreadView().worthDoing;
    // Nine cents each would never clear a dollar; thirty-five of them do, and
    // it is one listing either way.
    expect(row.gap).toBe(0.09);
    expect(row.total).toBe(3.15);
  });

  it("still refuses a difference too small to be a real signal", () => {
    saveSettings({ ...DEFAULT_SETTINGS, spreadMinAmount: 1, spreadMinPercent: 5 });
    const cases = seedCase({ quantity: 1000 });
    // A thousand copies makes the total large, but a 1% gap is inside the
    // noise of what a market shows minute to minute.
    priced(cases.id, 100, [quote("skinport", 100), quote("csfloat", 88.9)]);
    const view = spreadView();
    expect(view.worthDoing).toEqual([]);
    expect(view.slim).toHaveLength(1);
  });

  it("keeps a locked item in the list and out of the total", () => {
    const locked = seedRedline({ tradableAfter: new Date(Date.now() + 5 * 864e5).toISOString() });
    priced(locked.id, 100, [quote("skinport", 100), quote("csfloat", 95)]);
    const view = spreadView();
    expect(view.worthDoing).toHaveLength(1);
    expect(view.worthDoing[0].locked).toBe(true);
    expect(view.lockedCount).toBe(1);
  });

  it("ignores what has all been sold", () => {
    const gone = seedCase({ quantity: 0 });
    priced(gone.id, 1, [quote("skinport", 1), quote("csfloat", 1)]);
    const view = spreadView();
    expect(view.worthDoing).toEqual([]);
    expect(view.unpriced).toBe(0);
    expect(view.noComparison).toBe(0);
  });

  it("puts the biggest total first, not the biggest price tag", () => {
    saveSettings({ ...DEFAULT_SETTINGS, spreadMinAmount: 1, spreadMinPercent: 5 });
    const knife = seedRedline({ marketHashName: "★ Karambit | Doppler (Factory New)", category: "knife" });
    priced(knife.id, 1000, [quote("skinport", 1000), quote("csfloat", 950)]);
    const cases = seedCase({ quantity: 1000 });
    priced(cases.id, 2, [quote("skinport", 2), quote("csfloat", 1.9)]);
    // The knife is worth five hundred times more per copy, and moving it is
    // worth $51; moving the cases is worth $100.
    const [first, second] = spreadView().worthDoing;
    expect(first.item.id).toBe(cases.id);
    expect(second.item.id).toBe(knife.id);
  });
});
