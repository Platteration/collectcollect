import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchQuotes } from "../src/domain/pricing/index";
import type { PriceProvider } from "../src/domain/spec";
import { NO_LIMIT, rateLimit } from "../src/limiter";
import {
  PC_PRICE_FIELDS,
  PriceChartingError,
  bestProduct,
  fetchProduct,
  pricesFrom,
  scoreProduct,
  searchProducts,
  setPriceChartingLimit,
  type PcPriceField,
  type PcProduct,
} from "../src/pricing/pricecharting";

/**
 * The PriceCharting client the domain apps share. Its pacing and its price
 * fields are the card app's own (apps/cards/tests/providers.test.ts tests that
 * copy the same way), so the two ask PriceCharting alike.
 */

const product = (over: Partial<PcProduct> = {}): PcProduct => ({ id: "b", "product-name": "Charizard #4", "console-name": "Pokemon Base Set", "loose-price": 26000, ...over });

/** A fetch that answers every call with this body, and remembers what it was asked. */
function answering(body: unknown, status = 200) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return Object.assign(impl, { calls });
}

const found = { status: "success", ...product() };

beforeEach(() => setPriceChartingLimit(NO_LIMIT));
afterEach(() => setPriceChartingLimit(NO_LIMIT));

describe("the price fields", () => {
  it("knows the agencies' 10s PriceCharting keeps in condition-19, 20 and 21", () => {
    for (const field of ["condition-19-price", "condition-20-price", "condition-21-price"] as const) expect(PC_PRICE_FIELDS).toContain(field);
    // Every field in the list is a field a product can carry (this fails to compile if one is not).
    const all: PcProduct = { id: "1", "product-name": "x", "console-name": "y" };
    for (const field of PC_PRICE_FIELDS) all[field] = 100;
    expect(Object.keys(all)).toHaveLength(PC_PRICE_FIELDS.length + 3);
  });

  it("reads a mapping of fields to labels in dollars and leaves out a field that is missing or zero", () => {
    const mapping: Array<[PcPriceField, string]> = [
      ["condition-19-price", "CGC 10 Pristine"],
      ["condition-20-price", "BGS 10 Black Label"],
      ["condition-21-price", "TAG 10"],
      ["condition-18-price", "SGC 10"],
    ];
    const p = product({ "condition-19-price": 900000, "condition-20-price": 3000000, "condition-21-price": 550000, "condition-18-price": 0 });
    expect(pricesFrom(p, mapping)).toEqual({ "CGC 10 Pristine": 9000, "BGS 10 Black Label": 30000, "TAG 10": 5500 });
  });
});

describe("asking PriceCharting", () => {
  it("fetches a product by id and a search by query, with the token", async () => {
    const one = answering(found);
    expect((await fetchProduct("tok", "b", one))?.["product-name"]).toBe("Charizard #4");
    expect(one.calls[0]).toBe("https://www.pricecharting.com/api/product?t=tok&id=b");
    const many = answering({ status: "success", products: [product(), product({ id: "c" })] });
    expect(await searchProducts("tok", "Charizard #4", many)).toHaveLength(2);
    expect(many.calls[0]).toBe("https://www.pricecharting.com/api/products?t=tok&q=Charizard%20%234");
  });

  it("answers null for a product that is not there, and says what went wrong with a search", async () => {
    expect(await fetchProduct("tok", "gone", answering({ status: "error" }, 404))).toBeNull();
    expect(await fetchProduct("tok", "gone", answering({ status: "error" }))).toBeNull();
    await expect(searchProducts("tok", "x", answering({}, 503))).rejects.toThrow(/HTTP 503/);
    await expect(searchProducts("tok", "x", answering({ status: "error", "error-message": "Invalid token" }))).rejects.toThrow("Invalid token");
    await expect(searchProducts("tok", "x", answering({ status: "error" }))).rejects.toBeInstanceOf(PriceChartingError);
  });

  it("paces its calls to one a second across the process, and backs off for as long as a refusal asks", async () => {
    let now = 0;
    const sleeps: number[] = [];
    setPriceChartingLimit(rateLimit(1, 1000, { now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } }));
    const ok = answering(found);
    await fetchProduct("tok", "b", ok);
    await fetchProduct("tok", "b", ok);
    // The second call waited out the second the first one started.
    expect(sleeps).toEqual([1000]);
    now += 1000;
    const refusing = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch;
    await expect(fetchProduct("tok", "b", refusing)).rejects.toThrow(/PriceCharting is rate limiting this app; every PriceCharting lookup waits 30 seconds/);
    now += 1000;
    await fetchProduct("tok", "b", ok);
    // Past the per-second window but inside the pause PriceCharting asked for: the rest of it is waited out.
    expect(sleeps).toEqual([1000, 29000]);
  });

  it("keeps a search and a fetch by id in one queue, and a refusal of either stops both", async () => {
    let now = 0;
    const sleeps: number[] = [];
    setPriceChartingLimit(rateLimit(1, 1000, { now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } }));
    await fetchProduct("tok", "b", answering(found));
    await searchProducts("tok", "Charizard", answering({ status: "success", products: [] }));
    expect(sleeps).toEqual([1000]);
    const refusing = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    await expect(searchProducts("tok", "Charizard", refusing)).rejects.toThrow(/waits 60 seconds/);
    await fetchProduct("tok", "b", answering(found));
    // No Retry-After: a minute's pause, taken by the next caller whichever call it is.
    expect(sleeps.at(-1)).toBe(60000);
  });

  it("asks nothing of PriceCharting for a lookup it was told to give up on while it waited its turn", async () => {
    setPriceChartingLimit(rateLimit(1, 60_000));
    const ok = answering(found);
    await fetchProduct("tok", "b", ok);
    const controller = new AbortController();
    const waiting = searchProducts("tok", "Charizard", ok, controller.signal);
    const settled = expect(waiting).rejects.toThrow("Gave up waiting for a turn to ask PriceCharting.");
    setTimeout(() => controller.abort(), 20);
    await settled;
    expect(ok.calls).toHaveLength(1);
    // And one that was already given up on never joins the queue's next turn.
    const gone = new AbortController();
    gone.abort();
    await expect(fetchProduct("tok", "b", ok, gone.signal)).rejects.toThrow("Gave up waiting");
    expect(ok.calls).toHaveLength(1);
  });

  it("hands the signal to the request itself", async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const spy = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal);
      return new Response(JSON.stringify(found));
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    await fetchProduct("tok", "b", spy, controller.signal);
    expect(seen).toEqual([controller.signal]);
  });
});

describe("ranking", () => {
  it("scores the name, the console, the year and a bracketed variant", () => {
    const q = { name: "Charizard", consoleHints: ["Pokemon Base Set"], year: 1999 };
    const right = product({ "release-date": "1999-01-09" });
    const wrongSet = product({ "console-name": "Pokemon Jungle" });
    const bracketed = product({ "product-name": "Charizard [Shadowless]" });
    expect(scoreProduct(q, right)).toBeGreaterThan(scoreProduct(q, wrongSet));
    expect(scoreProduct(q, right)).toBeGreaterThan(scoreProduct(q, bracketed));
    // A copy that names its variant lands on the listing that says so.
    expect(scoreProduct({ ...q, variantWords: ["shadowless"] }, bracketed)).toBeGreaterThan(scoreProduct({ ...q, variantWords: ["shadowless"] }, right));
  });

  it("keeps the best candidate, or none when nothing clears the floor or there is nothing", () => {
    const a = product({ id: "a" });
    const b = product({ id: "b" });
    expect(bestProduct([a, b], (p) => (p.id === "b" ? 3 : 2))).toBe(b);
    expect(bestProduct([a, b], () => 1)).toBeNull();
    expect(bestProduct([a, b], () => 1, 0.5)).toBe(a);
    expect(bestProduct([], () => 10)).toBeNull();
  });
});

describe("the engine and a source that queues", () => {
  const lookingFor = { name: "Charizard" };
  const provider = (lookup: PriceProvider<{ name: string }>["lookup"]): PriceProvider<{ name: string }> => ({ id: "slow", label: "Slow source", optional: true, note: "", isConfigured: () => true, lookup });

  it("tells a source to stop when it gives up waiting, and not before", async () => {
    let seen: AbortSignal | undefined;
    const hangs = provider((_q, _f, signal) => {
      seen = signal;
      return new Promise(() => undefined);
    });
    const out = await fetchQuotes([hangs], lookingFor, fetch, 20);
    expect(out.errors).toEqual([{ source: "slow", message: "Slow source timed out" }]);
    expect(seen?.aborted).toBe(true);

    // A source that answered in time is not told to stop later, when its timer would have run out.
    let quick: AbortSignal | undefined;
    const answers = provider(async (_q, _f, signal) => {
      quick = signal;
      return [];
    });
    expect(await fetchQuotes([answers], lookingFor, fetch, 20)).toEqual({ quotes: [], errors: [] });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(quick).toBeDefined();
    expect(quick?.aborted).toBe(false);
  });

  it("does not let a lookup it timed out on ask PriceCharting later", async () => {
    // One call every minute: the second lookup waits for a turn longer than the engine will.
    setPriceChartingLimit(rateLimit(1, 60_000));
    const asked = answering({ status: "success", products: [] });
    const searching = provider((_q, fetchImpl, signal) => searchProducts("tok", "Charizard", fetchImpl, signal).then(() => []));
    const first = await fetchQuotes([searching], lookingFor, asked, 1000);
    expect(first.errors).toEqual([]);
    const second = await fetchQuotes([searching], lookingFor, asked, 30);
    expect(second.errors).toEqual([{ source: "slow", message: "Slow source timed out" }]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(asked.calls).toHaveLength(1);
  });
});
