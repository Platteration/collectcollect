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
import { tokens } from "@collectcollect/core/pricing/match";
import { ProviderError, type PriceProvider, type PriceQuote } from "@collectcollect/core/domain/spec";
import { priceChartingConsole, type GameQuery } from "../types";

/**
 * PriceCharting for video games (https://www.pricecharting.com/api-documentation).
 * The same paid token and the same HTTP client the card app uses, from the
 * shared package; what lives here is what the price fields mean for a game:
 *
 *   loose-price -> Loose        cib-price -> CIB            new-price -> New (sealed)
 *   graded-price -> Graded      box-only-price -> Box only  manual-only-price -> Manual only
 *
 * A copy is valued from the field its completeness names, so a CIB copy
 * reads the CIB price and a sealed one the New price. The graded price is
 * PriceCharting's blended figure for graded copies (mostly sealed WATA/VGA
 * slabs); it does not break down by grade.
 */

export const GAME_FIELDS: Array<[PcPriceField, string]> = [
  ["loose-price", "Loose"],
  ["cib-price", "CIB"],
  ["new-price", "New"],
  ["graded-price", "Graded"],
  ["box-only-price", "Box only"],
  ["manual-only-price", "Manual only"],
];

/** Title plus the console as PriceCharting names it, region prefix and all. */
export function buildSearch(q: GameQuery): string {
  const console = priceChartingConsole(q.platform, q.region);
  return [q.title, console].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * The shared ranking (name overlap, console, year, variant words) plus the
 * one thing a game adds: PriceCharting files PAL and Japanese releases under
 * prefixed console names, and a US copy must not be priced off a PAL listing.
 */
export function scoreProduct(q: GameQuery, p: PcProduct): number {
  const console = priceChartingConsole(q.platform, q.region);
  let score = baseScore({ name: q.title, consoleHints: console ? [console] : [], year: q.releaseYear, variantWords: tokens(q.variant) }, p);
  const c = p["console-name"].toLowerCase();
  const pal = /^pal\b/.test(c);
  const jp = /^jp\b/.test(c) || /famicom|pc engine/.test(c);
  if (q.region === "ntsc_u" && (pal || jp)) score -= 3;
  if (q.region === "pal" && !pal) score -= 3;
  if (q.region === "ntsc_j" && !jp) score -= 3;
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
    prices: pricesFrom(p, GAME_FIELDS),
    fetchedAt,
    externalId: p.id,
  };
}

export const priceChartingProvider: PriceProvider<GameQuery> = {
  id: "pricecharting",
  label: "PriceCharting",
  optional: true,
  note: "Set PRICECHARTING_TOKEN (paid API) for loose, CIB, sealed and graded prices on every platform. Without it, type prices in by hand.",
  isConfigured: isPriceChartingConfigured,
  async lookup(q, fetchImpl = fetch) {
    const token = priceChartingToken();
    if (!token) return [];
    // A product matched before is fetched by id, so a title that matches
    // several listings cannot drift between refreshes.
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
