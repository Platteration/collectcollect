import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { getItem, latestSnapshot, listSnapshots, markChecked, updateItem } from "@/lib/items";
import { itemsDir } from "@/lib/markdown/mirror";
import { fetchQuotes, netProceeds, primeProviders, proceedsByMarket, summarize } from "@/lib/pricing/index";
import { cancelRefresh, refreshAll, refreshItem, refreshRunning, resetRefreshThrottle } from "@/lib/pricing/refresh";
import { resetCatalogue, skinport } from "@/lib/pricing/providers/skinport";
import { parseSteamPrice, parseVolume, setRateLimit as setSteamLimit, steam } from "@/lib/pricing/providers/steam";
import { csfloat, setRateLimit as setCsFloatLimit } from "@/lib/pricing/providers/csfloat";
import { NO_LIMIT, rateLimit } from "@collectcollect/core/limiter";
import { dismissAlert, listAlerts } from "@/lib/alerts";
import { addSnapshot } from "@/lib/items";
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

/** The plain-text copy of one item, which a check must leave alone. */
function fileOf(id: number): string {
  const name = fs.readdirSync(itemsDir()).find((f) => f.startsWith(String(id).padStart(4, "0")))!;
  return fs.readFileSync(path.join(itemsDir(), name), "utf8");
}

describe("Skinport", () => {
  it("loads the catalogue once and answers every lookup from it", async () => {
    const fetchImpl = routes([["api.skinport.com", SKINPORT_CATALOGUE]]);
    await skinport.prime!(fetchImpl);
    const a = await skinport.lookup({ marketHashName: REDLINE }, fetchImpl);
    const b = await skinport.lookup({ marketHashName: "Clutch Case" }, fetchImpl);
    expect(a[0]?.price).toBe(11.5);
    expect(b[0]?.price).toBe(1.4);
    // One request for the whole inventory, which is the point of priming.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("records the lowest ask rather than their own estimate", async () => {
    const fetchImpl = routes([["api.skinport.com", SKINPORT_CATALOGUE]]);
    const [quote] = await skinport.lookup({ marketHashName: REDLINE }, fetchImpl);
    // suggested_price is 14.20. A price nobody is offering is not a price.
    expect(quote?.price).toBe(11.5);
    expect(quote?.volume).toBe(120);
    expect(quote?.url).toContain("skinport.com");
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
    expect(quote?.url).toContain("market/listings/730");
  });

  it("falls back to the median when nobody is listing one, and says so", async () => {
    const [quote] = await steam.lookup(
      { marketHashName: REDLINE },
      routes([["priceoverview", { success: true, median_price: "$9.50", volume: "3" }]]),
    );
    expect(quote?.price).toBe(9.5);
    // The label has to carry that, or a median reads as an ask.
    expect(quote?.sourceLabel).toMatch(/median/i);
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
    expect(quote?.price).toBe(11.99);
    expect(quote?.url).toContain("abc");
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

  it("records the highest listing, and values the copy at what the best cash market pays after its cut", () => {
    const summary = summarize({ manualPrice: null }, quotes, [], DEFAULT_SETTINGS);
    // Steam's is the highest number and still not the value: it is wallet funds.
    expect(summary.market).toBe(12.34);
    expect(summary.marketSource).toBe("Steam");
    // 11.50 on Skinport less its 12%.
    expect(summary.yourCopyValue).toBe(10.12);
    expect(summary.yourCopyBasis).toBe("Skinport listing, after its 12% cut");
    expect(summary.valueBasis).toBe("cash");
  });

  it("lets Steam's wallet figure stand in only when nothing pays in money, and says so", () => {
    const steamOnly = quotes.filter((q) => q.source === "steam");
    const summary = summarize({ manualPrice: null }, steamOnly, [], DEFAULT_SETTINGS);
    // 12.34 ÷ 1.15, what a seller nets in wallet funds.
    expect(summary.yourCopyValue).toBe(10.73);
    expect(summary.yourCopyBasis).toMatch(/wallet funds that cannot be withdrawn/);
    expect(summary.valueBasis).toBe("wallet");
  });

  it("lets a price typed in by hand beat every market", () => {
    const summary = summarize({ manualPrice: 40 }, quotes, [], DEFAULT_SETTINGS);
    expect(summary.yourCopyValue).toBe(40);
    expect(summary.yourCopyBasis).toBe("Your own price");
    expect(summary.valueBasis).toBe("manual");
    // The market prices are still recorded; they are just not the answer.
    expect(summary.market).toBe(12.34);
    expect(summary.quotes[0]?.source).toBe("manual");
  });

  it("says nothing was found rather than guessing a number", () => {
    const quiet = summarize({ manualPrice: null }, [], [], DEFAULT_SETTINGS);
    expect(quiet.yourCopyValue).toBeNull();
    expect(quiet.yourCopyBasis).toMatch(/No source is listing/);
    expect(quiet.valueBasis).toBeUndefined();

    const broken = summarize({ manualPrice: null }, [], [{ source: "Skinport", message: "down" }], DEFAULT_SETTINGS);
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
    expect(cash[0]?.net).toBe(90.16);
    expect(wallet[0]?.cashOut).toBe(false);
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
    // Skinport's 11.50 after its cut, not Steam's higher wallet figure.
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(10.12);
    expect(latestSnapshot(item.id)!.summary.market).toBe(12.34);
  });

  it("notes a check that found the same prices on the row it has, rather than storing it again", async () => {
    const item = seedRedline();
    const markets = () => {
      resetCatalogue();
      return routes([["api.skinport.com", SKINPORT_CATALOGUE], ["priceoverview", STEAM_OK]]);
    };
    const first = await refreshItem(item, markets());
    expect(first.stored).toBe(true);
    const file = fileOf(item.id);
    const again = await refreshItem(item, markets());
    expect(again).toMatchObject({ stored: false, unchanged: true });
    const rows = listSnapshots(item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.snapshot.id, fetchedAt: first.snapshot.fetchedAt, checkedAt: again.snapshot.checkedAt });
    expect(Date.parse(rows[0]!.checkedAt!)).toBeGreaterThanOrEqual(Date.parse(rows[0]!.fetchedAt));
    // A check rewrites no file: the plain-text copy is of prices, not of checks.
    expect(fileOf(item.id)).toBe(file);
    // A whole-inventory pass counts it, and treats the item as fresh from then:
    // the check decides staleness, not the row's date.
    expect(await refreshAll({ fetchImpl: markets() })).toMatchObject({ refreshed: 0, unchanged: 1, unpriced: 0, skipped: 0 });
    getDb().prepare("UPDATE price_snapshots SET fetched_at = ? WHERE id = ?").run(new Date(Date.now() - 72 * 3600e3).toISOString(), first.snapshot.id);
    resetRefreshThrottle();
    expect(await refreshAll({ staleHours: 24, fetchImpl: markets() })).toMatchObject({ refreshed: 0, unchanged: 0, skipped: 1 });
    // A move is a new fact, and gets a row of its own; the checked one keeps its note.
    const checked = listSnapshots(item.id)[0]?.checkedAt;
    resetCatalogue();
    const moved = routes([["api.skinport.com", [{ ...SKINPORT_CATALOGUE[0], min_price: 20 }]], ["priceoverview", STEAM_OK]]);
    expect((await refreshItem(item, moved)).stored).toBe(true);
    const after = listSnapshots(item.id);
    expect(after).toHaveLength(2);
    expect(after[0]?.checkedAt).toBeUndefined();
    expect(after[1]?.checkedAt).toBe(checked);
  });

  it("records no holdings event for a check", () => {
    const item = seedRedline();
    const snapshot = addSnapshot(item.id, { currency: "USD", fetchedAt: new Date().toISOString(), market: 10, marketSource: "Skinport", yourCopyValue: 8.8, yourCopyBasis: "x", quotes: [], errors: [] });
    const events = getDb().prepare("SELECT * FROM holdings_events ORDER BY id").all();
    markChecked(snapshot.id, new Date().toISOString());
    expect(getDb().prepare("SELECT * FROM holdings_events ORDER BY id").all()).toEqual(events);
    expect(latestSnapshot(item.id)?.checkedAt).toBeDefined();
  });

  it("does not write a failure over an item's last known value", async () => {
    const item = seedRedline();
    await refreshItem(item, routes([["api.skinport.com", SKINPORT_CATALOGUE]]));
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(10.12);

    resetCatalogue();
    const outcome = await refreshItem(item, routes([["api.skinport.com", {}, 503]]));
    expect(outcome.stored).toBe(false);
    // A market down for an afternoon must not erase the history.
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(10.12);
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
    // And the gate opens again once the first is done: the pass runs, and
    // finds the same prices it stored a moment ago.
    resetCatalogue();
    expect(await refreshAll({ fetchImpl })).toMatchObject({ refreshed: 0, unchanged: 1 });
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
    expect(alert?.title).toMatch(/is up 74%/);
    // What the owner would be paid, after Skinport's cut, on both sides.
    expect(alert?.body).toContain("$10.12");
    expect(alert?.body).toContain("$17.60");
  });

  it("does not call a change in what the value means a move", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, alertMovePercent: 15 });
    const item = seedRedline();
    // A snapshot from before values were what a cash market pays: the highest
    // listing before fees, with no basis recorded.
    addSnapshot(item.id, { currency: "USD", fetchedAt: "2026-01-01T00:00:00.000Z", market: 100, marketSource: "Steam", yourCopyValue: 100, yourCopyBasis: "Steam listing", quotes: [], errors: [] });
    await refreshItem(getItem(item.id)!, routes([["api.skinport.com", [{ ...SKINPORT_CATALOGUE[0], min_price: 20 }]]]));
    // 100 to 17.60 is not a fall of 82%; it is a different number about the same item.
    expect(listAlerts().filter((a) => a.kind === "price_move")).toEqual([]);
    // From then on, like against like.
    resetCatalogue();
    await refreshItem(getItem(item.id)!, routes([["api.skinport.com", [{ ...SKINPORT_CATALOGUE[0], min_price: 40 }]]]));
    expect(listAlerts().filter((a) => a.kind === "price_move").map((a) => a.title)).toEqual([`${REDLINE} is up 100%`]);
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
    expect(alert?.title).toContain("CSFloat");
    // 95 × 0.98 = 93.10 against 100 × 0.88 = 88.00.
    expect(alert?.title).toContain("$5.10");
    expect(alert?.body).toContain("$93.10");
    expect(alert?.body).not.toContain("Steam");
  });

  it("does not raise the same spread twice while prices stand still", async () => {
    process.env.CSFLOAT_API_KEY = "key";
    saveSettings({ ...DEFAULT_SETTINGS, spreadMinAmount: 1, spreadMinPercent: 5 });
    const item = seedRedline();
    const markets = (skinport: number) => {
      resetCatalogue();
      return routes([
        ["api.skinport.com", [{ market_hash_name: item.marketHashName, min_price: skinport }]],
        ["csfloat.com/api", { data: [{ id: "x", price: 9500 }] }],
      ]);
    };
    await refreshItem(item, markets(100));
    // The same prices again are a check, and a check has nothing to say.
    expect(await refreshItem(item, markets(100))).toMatchObject({ unchanged: true });
    expect(listAlerts().filter((a) => a.kind === "spread_opened")).toHaveLength(1);
    // Once a price moves, the spread is news again: 90 × 0.88 against 95 × 0.98.
    await refreshItem(item, markets(90));
    expect(listAlerts().filter((a) => a.kind === "spread_opened")).toHaveLength(2);
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
    expect(alert?.body).toMatch(/trade locked until/);
  });

  /** Time passes: a lock the app has known about since it was live ends. */
  const lockEnds = (itemId: number, daysAgo: number) =>
    getDb().prepare("UPDATE items SET tradable_after = ? WHERE id = ?").run(new Date(Date.now() - daysAgo * 864e5).toISOString(), itemId);

  it("says when a lock has ended, once", async () => {
    const item = seedRedline({ tradableAfter: new Date(Date.now() + 5 * 864e5).toISOString() });
    lockEnds(item.id, 1);
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

  it("does not announce a lock that had already ended when the item arrived", async () => {
    // Added by hand, or brought in from a spreadsheet, with a lock that ended
    // before the app knew the item: "can be traded again" would be stale news.
    seedRedline({ tradableAfter: new Date(Date.now() - 864e5).toISOString() });
    await refreshAll({ fetchImpl: routes([["api.skinport.com", SKINPORT_CATALOGUE]]) });
    expect(listAlerts().filter((a) => a.kind === "trade_lock_lifted")).toEqual([]);
    // The same for an edit that writes a lock already over.
    const edited = seedCase({ tradableAfter: new Date(Date.now() + 5 * 864e5).toISOString() });
    updateItem(edited.id, { tradableAfter: new Date(Date.now() - 864e5).toISOString() });
    resetCatalogue();
    resetRefreshThrottle();
    await refreshAll({ fetchImpl: routes([["api.skinport.com", SKINPORT_CATALOGUE]]) });
    expect(listAlerts().filter((a) => a.kind === "trade_lock_lifted")).toEqual([]);
  });

  it("does not repeat a lock's ending once its alert is dismissed, and does announce a later lock", async () => {
    const item = seedRedline({ tradableAfter: new Date(Date.now() + 5 * 864e5).toISOString() });
    lockEnds(item.id, 2);
    const refresh = async () => { resetCatalogue(); resetRefreshThrottle(); await refreshAll({ fetchImpl: routes([["api.skinport.com", SKINPORT_CATALOGUE]]) }); };
    await refresh();
    const [first] = listAlerts().filter((a) => a.kind === "trade_lock_lifted");
    expect(first).toBeDefined();
    dismissAlert(first!.id);
    await refresh();
    expect(listAlerts().filter((a) => a.kind === "trade_lock_lifted")).toEqual([]);
    // Traded, locked again, and that lock has now ended too: worth saying once more.
    updateItem(item.id, { tradableAfter: new Date(Date.now() + 5 * 864e5).toISOString() });
    lockEnds(item.id, 1);
    await refresh();
    expect(listAlerts().filter((a) => a.kind === "trade_lock_lifted")).toHaveLength(1);
    await refresh();
    expect(listAlerts().filter((a) => a.kind === "trade_lock_lifted")).toHaveLength(1);
  });
});

describe("a market that will not answer", () => {
  /** A clock the test drives, as in the limiter's own tests. */
  function fakeClock() {
    let now = 0;
    const sleeps: number[] = [];
    return { now: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += ms; }, sleeps };
  }

  it("waits out what Steam asks for after a refusal, on every lookup behind it", async () => {
    const clock = fakeClock();
    setSteamLimit(rateLimit(18, 60_000, clock));
    const refused = vi.fn(async () => new Response("{}", { status: 429, headers: { "Retry-After": "30" } })) as unknown as typeof fetch;
    await expect(steam.lookup({ marketHashName: REDLINE }, refused)).rejects.toThrow(/waits 30 seconds/);
    await steam.lookup({ marketHashName: REDLINE }, routes([["priceoverview", STEAM_OK]]));
    expect(clock.sleeps).toEqual([30_000]);
    // Without any advice, a minute.
    const silent = vi.fn(async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    await expect(steam.lookup({ marketHashName: REDLINE }, silent)).rejects.toThrow(/waits 60 seconds/);
  });

  it("gives up on a market that never answers, and says which one", async () => {
    const never = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const { quotes, errors } = await fetchQuotes({ marketHashName: REDLINE }, never, { timeoutMs: 30 });
    expect(quotes).toEqual([]);
    expect(errors.map((e) => e.message).sort()).toEqual(["Skinport did not answer within 0 seconds.", "Steam Community Market did not answer within 0 seconds."]);
  });

  it("can be told to stop a whole-inventory pass, and says what it left", async () => {
    seedRedline();
    seedCase();
    seedCase({ marketHashName: "Chroma Case" });
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const pass = refreshAll({ fetchImpl: hanging });
    expect(refreshRunning()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelRefresh();
    const result = await pass;
    expect(result.cancelled).toBe(true);
    expect(result.refreshed).toBe(0);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toBe(3);
    expect(refreshRunning()).toBe(false);
  });

  it("never writes an abandoned lookup down as an item's answer, not even its first", async () => {
    const first = seedRedline();
    const second = seedCase();
    // Skinport answers, with a catalogue listing neither; Steam never does.
    const fetchImpl = ((url: string, init?: RequestInit) =>
      url.includes("api.skinport.com")
        ? Promise.resolve(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }))
        : new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const pass = refreshAll({ fetchImpl });
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelRefresh();
    const result = await pass;
    expect(result).toMatchObject({ cancelled: true, refreshed: 0, unpriced: 0, skipped: 2, failed: [] });
    // Nothing was written, so the next pass asks about both as if for the first time.
    expect(listSnapshots(first.id)).toEqual([]);
    expect(listSnapshots(second.id)).toEqual([]);

    // The same for a single lookup that its caller gives up on.
    const controller = new AbortController();
    const single = refreshItem(first, fetchImpl, controller.signal);
    setTimeout(() => controller.abort(), 10);
    expect((await single).stored).toBe(false);
    expect(listSnapshots(first.id)).toEqual([]);
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
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(10.12);
  });
});
