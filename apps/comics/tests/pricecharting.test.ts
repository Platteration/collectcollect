import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderError } from "@collectcollect/core/domain/spec";
import { buildSearch, priceChartingProvider, productToQuote, scoreProduct } from "@/lib/pricing/pricecharting";
import type { ComicQuery } from "@/lib/types";
import { fakeFetch } from "./helpers";

const query = (over: Partial<ComicQuery> = {}): ComicQuery => ({ title: "Amazing Spider-Man", publisher: "Marvel", issueNumber: "300", volume: 1, coverYear: 1988, variant: null, externalIds: {}, ...over });

const asm300 = { id: "1", "product-name": "Amazing Spider-Man #300", "console-name": "Marvel Comics", "release-date": "1988-05-01", "loose-price": 25000, "cib-price": 30000, "new-price": 40000, "graded-price": 60000, "box-only-price": 90000, "manual-only-price": 110000, "bgs-10-price": 140000, "condition-17-price": 200000, "condition-18-price": 400000 };
const asm301 = { id: "2", "product-name": "Amazing Spider-Man #301", "console-name": "Marvel Comics", "loose-price": 5000 };
const facsimile = { id: "3", "product-name": "Amazing Spider-Man #300 [Facsimile Edition]", "console-name": "Marvel Comics", "loose-price": 800 };
const newsstand = { id: "4", "product-name": "Amazing Spider-Man #300 [Newsstand]", "console-name": "Marvel Comics", "release-date": "1988-05-01", "loose-price": 30000 };

beforeEach(() => {
  process.env.PRICECHARTING_TOKEN = "test-token";
});
afterEach(() => {
  delete process.env.PRICECHARTING_TOKEN;
});

describe("asking PriceCharting about a comic", () => {
  it("searches by series and issue, with the variant when there is one", () => {
    expect(buildSearch(query())).toBe("Amazing Spider-Man #300");
    expect(buildSearch(query({ variant: "Newsstand" }))).toBe("Amazing Spider-Man #300 Newsstand");
  });

  it("insists on the issue number and prefers the plain edition unless told otherwise", () => {
    const q = query();
    expect(scoreProduct(q, asm300)).toBeGreaterThan(scoreProduct(q, asm301));
    expect(scoreProduct(q, asm300)).toBeGreaterThan(scoreProduct(q, facsimile));
    expect(scoreProduct(q, asm300)).toBeGreaterThan(scoreProduct(q, newsstand));
    const ns = query({ variant: "Newsstand" });
    expect(scoreProduct(ns, newsstand)).toBeGreaterThan(scoreProduct(ns, asm300));
  });

  it("maps the price columns to grades", () => {
    const quote = productToQuote(asm300, "2026-01-01T00:00:00.000Z");
    expect(quote).toMatchObject({ source: "pricecharting", currency: "USD", price: 250, externalId: "1", matchedDetail: "Marvel Comics" });
    expect(quote.prices).toEqual({ "Grade 4.0": 300, "Grade 6.0": 400, "Grade 8.0": 600, "Grade 9.0": 900, "Grade 9.2": 1100, "Grade 9.4": 1400, "Grade 9.6": 2000, "Grade 9.8": 4000 });
  });

  it("looks the issue up and keeps the best match", async () => {
    const fetchImpl = fakeFetch([["/api/products?", { status: "success", products: [asm301, facsimile, newsstand, asm300] }]]);
    const quotes = await priceChartingProvider.lookup(query(), fetchImpl);
    expect(quotes.map((q) => q.externalId)).toEqual(["1"]);
    expect(fetchImpl.calls[0]).toContain("q=Amazing%20Spider-Man%20%23300");
  });

  it("fetches a product it matched before by id", async () => {
    const fetchImpl = fakeFetch([
      ["/api/product?", { status: "success", ...asm300 }],
      ["/api/products?", { status: "success", products: [asm301] }],
    ]);
    const quotes = await priceChartingProvider.lookup(query({ externalIds: { pricecharting: "1" } }), fetchImpl);
    expect(quotes[0].externalId).toBe("1");
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("answers with nothing rather than a wrong issue, and reports a refused token", async () => {
    expect(await priceChartingProvider.lookup(query(), fakeFetch([["/api/products?", { status: "success", products: [asm301] }]]))).toEqual([]);
    await expect(priceChartingProvider.lookup(query(), fakeFetch([["/api/products?", { status: "error", "error-message": "Invalid token" }]]))).rejects.toBeInstanceOf(ProviderError);
    delete process.env.PRICECHARTING_TOKEN;
    expect(await priceChartingProvider.lookup(query(), fakeFetch([["/api/products?", { status: "success", products: [asm300] }]]))).toEqual([]);
  });
});
