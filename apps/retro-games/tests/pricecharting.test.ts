import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderError } from "@collectcollect/core/domain/spec";
import { buildSearch, priceChartingProvider, productToQuote, scoreProduct } from "@/lib/pricing/pricecharting";
import type { GameQuery } from "@/lib/types";
import { fakeFetch } from "./helpers";

const query = (over: Partial<GameQuery> = {}): GameQuery => ({ title: "Super Mario 64", platform: "n64", region: "ntsc_u", releaseYear: 1996, variant: null, externalIds: {}, ...over });

const us = { id: "1", "product-name": "Super Mario 64", "console-name": "Nintendo 64", "release-date": "1996-09-29", "loose-price": 3500, "cib-price": 12000, "new-price": 250000, "graded-price": 900000, "box-only-price": 6000, "manual-only-price": 2500 };
const pal = { id: "2", "product-name": "Super Mario 64", "console-name": "PAL Nintendo 64", "loose-price": 3000, "cib-price": 9000 };
const choice = { id: "3", "product-name": "Super Mario 64 [Player's Choice]", "console-name": "Nintendo 64", "release-date": "1996-09-29", "loose-price": 3000, "cib-price": 9000 };
const other = { id: "4", "product-name": "Super Mario 64 DS", "console-name": "Nintendo DS", "loose-price": 1500 };

beforeEach(() => {
  process.env.PRICECHARTING_TOKEN = "test-token";
});
afterEach(() => {
  delete process.env.PRICECHARTING_TOKEN;
});

describe("asking PriceCharting about a game", () => {
  it("searches by title and the console as PriceCharting names it, region and all", () => {
    expect(buildSearch(query())).toBe("Super Mario 64 Nintendo 64");
    expect(buildSearch(query({ region: "pal" }))).toBe("Super Mario 64 PAL Nintendo 64");
    expect(buildSearch(query({ platform: "snes", region: "ntsc_j", title: "Super Metroid" }))).toBe("Super Metroid Super Famicom");
    expect(buildSearch(query({ platform: "genesis", region: "pal", title: "Sonic 2" }))).toBe("Sonic 2 PAL Sega Mega Drive");
  });

  it("prefers the listing on the right platform and in the right region", () => {
    const q = query();
    expect(scoreProduct(q, us)).toBeGreaterThan(scoreProduct(q, pal));
    expect(scoreProduct(q, us)).toBeGreaterThan(scoreProduct(q, other));
    expect(scoreProduct(q, us)).toBeGreaterThan(scoreProduct(q, choice));
    const p = query({ region: "pal" });
    expect(scoreProduct(p, pal)).toBeGreaterThan(scoreProduct(p, us));
    const variant = query({ variant: "Player's Choice" });
    expect(scoreProduct(variant, choice)).toBeGreaterThan(scoreProduct(variant, us));
  });

  it("maps the price fields to loose, CIB, new and graded", () => {
    const quote = productToQuote(us, "2026-01-01T00:00:00.000Z");
    expect(quote).toMatchObject({ source: "pricecharting", currency: "USD", price: 35, externalId: "1", matchedDetail: "Nintendo 64" });
    expect(quote.prices).toEqual({ Loose: 35, CIB: 120, New: 2500, Graded: 9000, "Box only": 60, "Manual only": 25 });
    expect(quote.url).toContain("pricecharting.com");
  });

  it("leaves out a price PriceCharting writes as zero", () => {
    expect(productToQuote({ ...pal, "new-price": 0 }).prices).toEqual({ Loose: 30, CIB: 90 });
  });

  it("looks the game up and keeps the best match", async () => {
    const fetchImpl = fakeFetch([["/api/products?", { status: "success", products: [other, pal, choice, us] }]]);
    const quotes = await priceChartingProvider.lookup(query(), fetchImpl);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].externalId).toBe("1");
    expect(fetchImpl.calls[0]).toContain("q=Super%20Mario%2064%20Nintendo%2064");
    expect(fetchImpl.calls[0]).toContain("t=test-token");
  });

  it("fetches a product it matched before by id instead of searching again", async () => {
    const fetchImpl = fakeFetch([
      ["/api/product?", { status: "success", ...us }],
      ["/api/products?", { status: "success", products: [pal] }],
    ]);
    const quotes = await priceChartingProvider.lookup(query({ externalIds: { pricecharting: "1" } }), fetchImpl);
    expect(quotes[0].externalId).toBe("1");
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]).toContain("/api/product?");
  });

  it("falls back to a search when the stored id no longer answers", async () => {
    const fetchImpl = fakeFetch([
      ["/api/product?", { status: "error" }, 404],
      ["/api/products?", { status: "success", products: [us] }],
    ]);
    const quotes = await priceChartingProvider.lookup(query({ externalIds: { pricecharting: "gone" } }), fetchImpl);
    expect(quotes[0].externalId).toBe("1");
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it("answers with nothing rather than a wrong game", async () => {
    const fetchImpl = fakeFetch([["/api/products?", { status: "success", products: [{ id: "9", "product-name": "Tetris", "console-name": "GameBoy", "loose-price": 1000 }] }]]);
    expect(await priceChartingProvider.lookup(query(), fetchImpl)).toEqual([]);
  });

  it("says so when the token is refused", async () => {
    const fetchImpl = fakeFetch([["/api/products?", { status: "error", "error-message": "Invalid token" }]]);
    await expect(priceChartingProvider.lookup(query(), fetchImpl)).rejects.toBeInstanceOf(ProviderError);
    const down = fakeFetch([["/api/products?", {}, 503]]);
    await expect(priceChartingProvider.lookup(query(), down)).rejects.toThrow(/503/);
  });

  it("does nothing without a token", async () => {
    delete process.env.PRICECHARTING_TOKEN;
    expect(priceChartingProvider.isConfigured()).toBe(false);
    const fetchImpl = fakeFetch([["/api/products?", { status: "success", products: [us] }]]);
    expect(await priceChartingProvider.lookup(query(), fetchImpl)).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
