import {
  PriceChartingError,
  bestProduct,
  cents,
  fetchProduct,
  isPriceChartingConfigured,
  priceChartingToken,
  pricesFrom,
  productUrl,
  scoreProduct as baseScore,
  searchProducts,
  type PcPriceField,
  type PcProduct,
} from "@collectcollect/core/pricing/pricecharting";
import { numberPart, sameNumber, tokens } from "@collectcollect/core/pricing/match";
import { ProviderError, type PriceProvider, type PriceQuote } from "@collectcollect/core/domain/spec";
import type { ComicQuery } from "../types";

/**
 * PriceCharting for comic books, through the client the card and game apps
 * share. One paid token covers every category; what lives here is what the
 * price fields mean for a comic, which PriceCharting keys by grade:
 *
 *   loose-price -> Ungraded      cib-price -> Grade 4.0      new-price -> Grade 6.0
 *   graded-price -> Grade 8.0    box-only-price -> Grade 9.0 manual-only-price -> Grade 9.2
 *   bgs-10-price -> Grade 9.4    condition-17-price -> Grade 9.6  condition-18-price -> Grade 9.8
 *
 * This mapping is from PriceCharting's documentation as remembered while
 * offline and has not been checked against a live response; the README
 * says so. A wrong column would show as a wrong grade label beside a right
 * number, never as a wrong copy value from a right label.
 */

export const COMIC_FIELDS: Array<[PcPriceField, string]> = [
  ["cib-price", "Grade 4.0"],
  ["new-price", "Grade 6.0"],
  ["graded-price", "Grade 8.0"],
  ["box-only-price", "Grade 9.0"],
  ["manual-only-price", "Grade 9.2"],
  ["bgs-10-price", "Grade 9.4"],
  ["condition-17-price", "Grade 9.6"],
  ["condition-18-price", "Grade 9.8"],
];

export function buildSearch(q: ComicQuery): string {
  return [q.title, q.issueNumber ? `#${q.issueNumber}` : null, q.variant].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** The shared ranking, plus the one thing that names a comic: the issue number has to agree. */
export function scoreProduct(q: ComicQuery, p: PcProduct): number {
  let score = baseScore({ name: q.title, consoleHints: q.publisher ? [q.publisher] : [], year: q.coverYear, variantWords: tokens(q.variant) }, p);
  const productNumber = p["product-name"].match(/#\s*([A-Za-z0-9.-]+)/)?.[1] ?? numberPart(p["product-name"].replace(q.title, ""));
  if (q.issueNumber) {
    // A different issue number is a different comic, whatever else agrees.
    if (sameNumber(q.issueNumber, productNumber)) score += 3;
    else if (productNumber) score -= 8;
  }
  return score;
}

export function productToQuote(p: PcProduct, fetchedAt = new Date().toISOString()): PriceQuote {
  return {
    source: "pricecharting",
    sourceLabel: "PriceCharting",
    currency: "USD",
    url: productUrl(p),
    matchedName: p["product-name"],
    matchedDetail: p["console-name"],
    price: cents(p["loose-price"]),
    prices: pricesFrom(p, COMIC_FIELDS),
    fetchedAt,
    externalId: p.id,
  };
}

export const priceChartingProvider: PriceProvider<ComicQuery> = {
  id: "pricecharting",
  label: "PriceCharting",
  optional: true,
  note: "Set PRICECHARTING_TOKEN (paid API) for raw and graded prices by grade. Its comic columns are mapped from memory and flagged in the README. Without it, type prices in by hand.",
  isConfigured: isPriceChartingConfigured,
  async lookup(q, fetchImpl = fetch) {
    const token = priceChartingToken();
    if (!token) return [];
    const knownId = q.externalIds?.pricecharting;
    if (knownId) {
      const product = await fetchProduct(token, knownId, fetchImpl);
      if (product) return [productToQuote(product)];
    }
    let products: PcProduct[];
    try {
      products = await searchProducts(token, buildSearch(q), fetchImpl);
    } catch (e) {
      if (e instanceof PriceChartingError) throw new ProviderError("pricecharting", e.message);
      throw e;
    }
    const best = bestProduct(products, (p) => scoreProduct(q, p));
    return best ? [productToQuote(best)] : [];
  },
};
