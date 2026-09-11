import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { getItem, latestSnapshot, listSnapshots, updateItem } from "@/lib/items";
import { fetchQuotes, netProceeds, primeProviders, proceedsByMarket, summarize } from "@/lib/pricing/index";
import { refreshAll, refreshItem, resetRefreshThrottle } from "@/lib/pricing/refresh";
import { resetCatalogue, skinport } from "@/lib/pricing/providers/skinport";
import { parseSteamPrice, parseVolume, setRateLimit as setSteamLimit, steam } from "@/lib/pricing/providers/steam";
import { csfloat, setRateLimit as setCsFloatLimit } from "@/lib/pricing/providers/csfloat";
import { NO_LIMIT } from "@collectcollect/core/limiter";
import { listAlerts } from "@/lib/alerts";
import { saveSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS, type PriceQuote } from "@/lib/types";
import { seedCase, seedRedline } from "./helpers";

const REDLINE = "AK-47 | Redline (Field-Tested)";

beforeEach(() => {
  setDb(openDatabase(":memory:"));
  resetCatalogue();
  resetRefreshThrottle();
  // Neither limit should make a test wait a real minute.
  setSteamLimit(NO_LIMIT);
  setCsFloatLimit(NO_LIMIT);
  delete process.env.CSFLOAT_API_KEY;
});

afterEach(() => {
  delete process.env.CSFLOAT_API_KEY;
});

/** A fetch stub answering by URL substring, in order of first match. */
function routes(table: Array<[string, unknown, number?]>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const [match, body, status = 200] of table) {
      if (url.includes(match)) {
        return new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

const SKINPORT_CATALOGUE = [
  { market_hash_name: REDLINE, currency: "USD", min_price: 11.5, suggested_price: 14.2, quantity: 120, item_page: "https://skinport.com/item/ak-47-redline-field-tested" },
  { market_hash_name: "Clutch Case", currency: "USD", min_price: 1.4, quantity: 9000 },
  { market_hash_name: "Nobody Wants This", currency: "USD", min_price: null },
];

const STEAM_OK = { success: true, lowest_price: "$12.34", median_price: "$12.00", volume: "1,203" };

describe("Skinport", () => {
  it("loads the catalogue once and answers every lookup from it", async () => {
    const fetchImpl = routes([["api.skinport.com", SKINPORT_CATALOGUE]]);
    await skinport.prime!(fetchImpl);
    const a = await skinport.lookup({ marketHashName: REDLINE }, fetchImpl);
    const b = await skinport.lookup({ marketHashName: "Clutch Case" }, fetchImpl);
    expect(a[0].price).toBe(11.5);
    expect(b[0].price).toBe(1.4);
    // One request for the whole inventory, which is the point of priming.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("records the lowest ask rather than their own estimate", async () => {
    const fetchImpl = routes([["api.skinport.com", SKINPORT_CATALOGUE]]);
    const [quote] = await skinport.lookup({ marketHashName: REDLINE }, fetchImpl);
    // suggested_price is 14.20. A price nobody is offering is not a price.
    expect(quote.price).toBe(11.5);
    expect(quote.volume).toBe(120);
    expect(quote.url).toContain("skinport.com");
  });

  it("has nothing to say about something nobody is selling", async () => {
    const fetchImpl = routes([["api.skinport.com", SKINPORT_CATALOGUE]]);
    expect(await skinport.lookup({ marketHashName: "Nobody Wants This" }, fetchImpl)).toEqual([]);
    expect(await skinport.lookup({ marketHashName: "Not In The Catalogue" }, fetchImpl)).toEqual([]);
  });

  it("says what went wrong rather than caching a failure", async () => {
    await expect(skinport.prime!(routes([["api.skinport.com", {}, 429]]))).rejects.toThrow(/rate limiting/);
    await expect(skinport.prime!(routes([["api.skinport.com", {}, 503]]))).rejects.toThrow(/503/);
    await expect(skinport.prime!(routes([["api.skinport.com", { not: "a list" }]]))).rejects.toThrow(/not a list/);
    await expect(skinport.prime!(routes([["api.skinport.com", []]]))).rejects.toThrow(/empty catalogue/);
    // Having failed, it must still be able to succeed.
    const good = routes([["api.skinport.com", SKINPORT_CATALOGUE]]);
    await expect(skinport.prime!(good)).resolves.toBeUndefined();
  });
});

describe("Steam", () => {
  it("reads a price overview", async () => {
    const [quote] = await steam.lookup({ marketHashName: REDLINE }, routes([["priceoverview", STEAM_OK]]));
    expect(quote).toMatchObject({ source: "steam", price: 12.34, volume: 1203 });
    expect(quote.url).toContain("market/listings/730");
  });

  it("falls back to the median when nobody is listing one, and says so", async () => {
    const [quote] = await steam.lookup(
      { marketHashName: REDLINE },
      routes([["priceoverview", { success: true, median_price: "$9.50", volume: "3" }]]),
    );
    expect(quote.price).toBe(9.5);
    // The label has to carry that, or a median reads as an ask.
    expect(quote.sourceLabel).toMatch(/median/i);
  });

  it("treats a name Steam does not list as an ordinary answer", async () => {
    expect(await steam.lookup({ marketHashName: "Nope" }, routes([["priceoverview", { success: false }]]))).toEqual([]);
  });

  it("turns a rate limit into something a person can act on", async () => {
    await expect(steam.lookup({ marketHashName: REDLINE }, routes([["priceoverview", "", 429]]))).rejects.toThrow(
      /twenty requests a minute/,
    );
  });

  it("reads money however Steam writes it", () => {
    expect(parseSteamPrice("$12.34")).toBe(12.34);
    expect(parseSteamPrice("$1,234.56")).toBe(1234.56);
    // Some currencies put the comma where the point goes.
    expect(parseSteamPrice("1.234,56€")).toBe(1234.56);
    expect(parseSteamPrice("12,34€")).toBe(12.34);
    expect(parseSteamPrice("")).toBeNull();
    expect(parseSteamPrice(undefined)).toBeNull();
    expect(parseVolume("1,203")).toBe(1203);
    expect(parseVolume(undefined)).toBeNull();
  });
});

describe("CSFloat", () => {
  it("stays out of the way with no key, rather than failing every lookup", async () => {
    expect(csfloat.isConfigured()).toBe(false);
    expect(await csfloat.lookup({ marketHashName: REDLINE }, routes([]))).toEqual([]);
  });

  it("reads a listing, in dollars", async () => {
    process.env.CSFLOAT_API_KEY = "key";
    const [quote] = await csfloat.lookup(
      { marketHashName: REDLINE },
      routes([["csfloat.com/api", { data: [{ id: "abc", price: 1199, item: { market_hash_name: REDLINE } }] }]]),
    );
    // Their prices are in cents.
    expect(quote.price).toBe(11.99);
    expect(quote.url).toContain("abc");
  });

  it("says when the key is refused", async () => {
    process.env.CSFLOAT_API_KEY = "bad";
    await expect(csfloat.lookup({ marketHashName: REDLINE }, routes([["csfloat.com/api", {}, 401]]))).rejects.toThrow(
      /refused that key/,
    );
  });
});

describe("asking every source", () => {
  it("keeps the answers it got when one source fails", async () => {
    const fetchImpl = routes([
      ["api.skinport.com", SKINPORT_CATALOGUE],
      ["priceoverview", "", 500],
    ]);
    const { quotes, errors } = await fetchQuotes({ marketHashName: REDLINE }, fetchImpl);
    expect(quotes.map((q) => q.source)).toEqual(["skinport"]);
    expect(errors).toEqual([{ source: "Steam Community Market", message: "Steam answered 500." }]);
  });

  it("reports a catalogue that would not load rather than throwing", async () => {
    const errors = await primeProviders(routes([["api.skinport.com", {}, 503]]));
    expect(errors).toEqual([{ source: "Skinport", message: "Skinport answered 503." }]);
  });
});

describe("folding the answers together", () => {
  const quotes: PriceQuote[] = [
    { source: "skinport", sourceLabel: "Skinport", currency: "USD", url: null, matchedName: REDLINE, price: 11.5, volume: 1, fetchedAt: "x" },
    { source: "steam", sourceLabel: "Steam", currency: "USD", url: null, matchedName: REDLINE, price: 12.34, volume: 1, fetchedAt: "x" },
  ];

  it("takes the highest, and says which market it was", () => {
    const summary = summarize({ manualPrice: null, stattrak: false, souvenir: false }, quotes, []);
    expect(summary.market).toBe(12.34);
    expect(summary.marketSource).toBe("Steam");
    expect(summary.yourCopyValue).toBe(12.34);
  });

  it("lets a price typed in by hand beat every market", () => {
    const summary = summarize({ manualPrice: 40, stattrak: false, souvenir: false }, quotes, []);
    expect(summary.yourCopyValue).toBe(40);
    expect(summary.yourCopyBasis).toBe("Your own price");
    // The market prices are still recorded; they are just not the answer.
    expect(summary.market).toBe(12.34);
    expect(summary.quotes[0].source).toBe("manual");
  });

  it("says nothing was found rather than guessing a number", () => {
    const quiet = summarize({ manualPrice: null, stattrak: false, souvenir: false }, [], []);
    expect(quiet.yourCopyValue).toBeNull();
    expect(quiet.yourCopyBasis).toMatch(/No source is listing/);

    const broken = summarize({ manualPrice: null, stattrak: false, souvenir: false }, [], [{ source: "Skinport", message: "down" }]);
    // A market with nobody selling and a market that is down are different
    // things, and the basis has to keep them apart.
    expect(broken.yourCopyBasis).toMatch(/every source failed/);
  });
});

describe("what each market would actually pay", () => {
  const settings = DEFAULT_SETTINGS;
  const quotes: PriceQuote[] = [
    { source: "steam", sourceLabel: "Steam", currency: "USD", url: null, matchedName: "", price: 100, volume: null, fetchedAt: "x" },
    { source: "skinport", sourceLabel: "Skinport", currency: "USD", url: null, matchedName: "", price: 95, volume: null, fetchedAt: "x" },
    { source: "csfloat", sourceLabel: "CSFloat", currency: "USD", url: null, matchedName: "", price: 92, volume: null, fetchedAt: "x" },
  ];

  it("takes the fee off the buyer's price", () => {
    expect(netProceeds(100, "skinport", settings)).toBe(88);
    expect(netProceeds(100, "csfloat", settings)).toBe(98);
    // Steam's 15% is charged to the buyer, so the seller nets price ÷ 1.15.
    expect(netProceeds(115, "steam", settings)).toBeCloseTo(100, 0);
  });

  it("never ranks wallet funds against money", () => {
    const { cash, wallet } = proceedsByMarket(quotes, settings);
    // Steam's listing is the highest of the three and nets the most, and it
    // still does not appear among the markets that pay in money.
    expect(wallet.map((r) => r.market)).toEqual(["steam"]);
    expect(cash.map((r) => r.market)).toEqual(["csfloat", "skinport"]);
    expect(cash[0].net).toBe(90.16);
    expect(wallet[0].cashOut).toBe(false);
  });

  it("ignores a price typed in by hand, which is not a market", () => {
    const manual: PriceQuote = {
      source: "manual",
      sourceLabel: "Your own price",
      currency: "USD",
      url: null,
      matchedName: "",
      price: 999,
      volume: null,
      fetchedAt: "x",
    };
    const { cash, wallet } = proceedsByMarket([manual, ...quotes], settings);
    expect([...cash, ...wallet].some((r) => r.price === 999)).toBe(false);
  });
});

describe("refreshing", () => {
  it("records what it found", async () => {
    const item = seedRedline();
    const fetchImpl = routes([
      ["api.skinport.com", SKINPORT_CATALOGUE],
      ["priceoverview", STEAM_OK],
    ]);
    const outcome = await refreshItem(item, fetchImpl);
    expect(outcome.stored).toBe(true);
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(12.34);
  });

  it("does not write a failure over an item's last known value", async () => {
    const item = seedRedline();
    await refreshItem(item, routes([["api.skinport.com", SKINPORT_CATALOGUE]]));
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(11.5);

    resetCatalogue();
    const outcome = await refreshItem(item, routes([["api.skinport.com", {}, 503]]));
    expect(outcome.stored).toBe(false);
    // A market down for an afternoon must not erase the history.
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(11.5);
    expect(listSnapshots(item.id)).toHaveLength(1);
  });

  it("runs one whole-inventory pass at a time", async () => {
    seedRedline();
    const { BusyError } = await import("@collectcollect/core/gate");
    const fetchImpl = routes([["api.skinport.com", SKINPORT_CATALOGUE]]);
    const first = refreshAll({ fetchImpl });
    // The second caller is told, not queued: the pass it wants is the one running.
    await expect(refreshAll({ fetchImpl })).rejects.toBeInstanceOf(BusyError);
    expect(await first).toMatchObject({ refreshed: 1 });
    resetCatalogue();
    expect(await refreshAll({ fetchImpl })).toMatchObject({ refreshed: 1 });
  });

  it("loads a catalogue once for a whole inventory", async () => {
    seedRedline();
    seedCase({ quantity: 5 });
    const fetchImpl = routes([
      ["api.skinport.com", SKINPORT_CATALOGUE],
      ["priceoverview", { success: false }],
    ]);
    const result = await refreshAll({ fetchImpl });
    expect(result.refreshed).toBe(2);
    const calls = (fetchImpl as unknown as { mock: { calls: Array<[string]> } }).mock.calls;
    expect(calls.filter(([url]) => String(url).includes("api.skinport.com"))).toHaveLength(1);
  });

  it("leaves alone what was priced recently enough", async () => {
    const item = seedRedline();
    const fetchImpl = routes([["api.skinport.com", SKINPORT_CATALOGUE]]);
    await refreshAll({ fetchImpl });
    const again = await refreshAll({ staleHours: 24, fetchImpl });
    expect(again.skipped).toBe(1);
    expect(again.refreshed).toBe(0);
    expect(listSnapshots(item.id)).toHaveLength(1);
  });

  it("says which catalogue would not load", async () => {
    seedRedline();
    const result = await refreshAll({ fetchImpl: routes([["api.skinport.com", {}, 503]]) });
    expect(result.providerErrors).toEqual([{ source: "Skinport", message: "Skinport answered 503." }]);
  });
});

describe("alerts", () => {
  it("says nothing about the first price an item ever gets", async () => {
    const item = seedRedline();
    await refreshItem(item, routes([["api.skinport.com", SKINPORT_CATALOGUE]]));
    expect(listAlerts().filter((a) => a.kind === "price_move")).toEqual([]);
  });

  it("raises a move once it clears the threshold", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, alertMovePercent: 15 });
    const item = seedRedline();
    await refreshItem(item, routes([["api.skinport.com", SKINPORT_CATALOGUE]]));

    resetCatalogue();
    const dearer = [{ ...SKINPORT_CATALOGUE[0], min_price: 20 }];
    await refreshItem(getItem(item.id)!, routes([["api.skinport.com", dearer]]));

    const [alert] = listAlerts().filter((a) => a.kind === "price_move");
    expect(alert.title).toMatch(/is up 74%/);
    expect(alert.body).toContain("$11.50");
    expect(alert.body).toContain("$20.00");
  });

  it("stays quiet about a move too small to act on", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, alertMovePercent: 15 });
    const item = seedRedline();
    await refreshItem(item, routes([["api.skinport.com", SKINPORT_CATALOGUE]]));
    resetCatalogue();
    await refreshItem(getItem(item.id)!, routes([["api.skinport.com", [{ ...SKINPORT_CATALOGUE[0], min_price: 12 }]]]));
    expect(listAlerts().filter((a) => a.kind === "price_move")).toEqual([]);
  });

  it("raises a spread only between markets that pay in money", async () => {
    process.env.CSFLOAT_API_KEY = "key";
    saveSettings({ ...DEFAULT_SETTINGS, spreadMinAmount: 1, spreadMinPercent: 5 });
    const item = seedRedline();
    // Steam's listing is by far the highest, and it still cannot be either side
    // of a spread, because its proceeds are not money. Between the two markets
    // that do pay in money, CSFloat lists lower but keeps only 2% against
    // Skinport's 12%, so it is the one worth selling on.
    await refreshItem(
      item,
      routes([
        ["api.skinport.com", [{ market_hash_name: item.marketHashName, min_price: 100 }]],
        ["priceoverview", { success: true, lowest_price: "$500.00" }],
        ["csfloat.com/api", { data: [{ id: "x", price: 9500 }] }],
      ]),
    );
    const [alert] = listAlerts().filter((a) => a.kind === "spread_opened");
    expect(alert.title).toContain("CSFloat");
    // 95 × 0.98 = 93.10 against 100 × 0.88 = 88.00.
    expect(alert.title).toContain("$5.10");
    expect(alert.body).toContain("$93.10");
    expect(alert.body).not.toContain("Steam");
  });

  it("says a spread cannot be acted on while the item is locked", async () => {
    process.env.CSFLOAT_API_KEY = "key";
    const item = seedRedline({ tradableAfter: new Date(Date.now() + 5 * 864e5).toISOString() });
    await refreshItem(
      item,
      routes([
        ["api.skinport.com", [{ market_hash_name: item.marketHashName, min_price: 100 }]],
        ["csfloat.com/api", { data: [{ id: "x", price: 8000 }] }],
      ]),
    );
    const [alert] = listAlerts().filter((a) => a.kind === "spread_opened");
    expect(alert.body).toMatch(/trade locked until/);
  });

  it("says when a lock has ended, once", async () => {
    seedRedline({ tradableAfter: new Date(Date.now() - 864e5).toISOString() });
    await refreshAll({ fetchImpl: routes([["api.skinport.com", SKINPORT_CATALOGUE]]) });
    resetCatalogue();
    resetRefreshThrottle();
    await refreshAll({ fetchImpl: routes([["api.skinport.com", SKINPORT_CATALOGUE]]) });
    expect(listAlerts().filter((a) => a.kind === "trade_lock_lifted")).toHaveLength(1);
  });

  it("says nothing about a lock that has not ended", async () => {
    seedRedline({ tradableAfter: new Date(Date.now() + 864e5).toISOString() });
    await refreshAll({ fetchImpl: routes([["api.skinport.com", SKINPORT_CATALOGUE]]) });
    expect(listAlerts().filter((a) => a.kind === "trade_lock_lifted")).toEqual([]);
  });
});

describe("a price of your own", () => {
  it("survives a refresh that found a market price", async () => {
    const item = seedRedline({ manualPrice: 40 });
    await refreshItem(item, routes([["api.skinport.com", SKINPORT_CATALOGUE]]));
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(40);
    expect(latestSnapshot(item.id)!.summary.market).toBe(11.5);
  });

  it("hands the item back to the market when cleared", async () => {
    const item = seedRedline({ manualPrice: 40 });
    updateItem(item.id, { manualPrice: null });
    await refreshItem(getItem(item.id)!, routes([["api.skinport.com", SKINPORT_CATALOGUE]]));
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(11.5);
  });
});
