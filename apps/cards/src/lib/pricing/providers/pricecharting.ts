import type { Game, PriceQuote } from "../../types";
import type { CardQuery, PriceProvider } from "../types";
import { ProviderError } from "../types";
import { numberPart, round2, sameNumber, setSimilarity, tokenOverlap, tokens } from "../match";
import {
  PriceChartingError,
  fetchProduct,
  isPriceChartingConfigured,
  priceChartingToken,
  productUrl,
  searchProducts,
  type PcProduct,
  type PcPriceField,
} from "@collectcollect/core/pricing/pricecharting";
import { rateLimit, retryAfterMs, type RateLimit } from "@collectcollect/core/limiter";

/**
 * PriceCharting (https://www.pricecharting.com/api-documentation). Requires a
 * paid API token (PRICECHARTING_TOKEN). It is the one source here that reports
 * graded prices (PSA / BGS / CGC / SGC / TAG) and it covers Pokémon, Yu-Gi-Oh!,
 * Magic and sports cards alike, so when it is configured it is preferred.
 *
 * The HTTP client lives in the shared package, since a game or a comic is
 * priced from the same API; what stays here is what the price fields mean for
 * a trading card:
 *   loose-price -> Ungraded      cib-price -> Grade 7        new-price -> Grade 8
 *   graded-price -> Grade 9      box-only-price -> Grade 9.5  manual-only-price -> PSA 10
 *   bgs-10-price -> BGS 10       condition-17-price -> CGC 10  condition-18-price -> SGC 10
 *   condition-19-price -> CGC 10 Pristine   condition-20-price -> BGS 10 Black Label
 *   condition-21-price -> TAG 10
 */

export type { PcProduct };

const GRADED_FIELDS: Array<[PcPriceField, string]> = [
  ["cib-price", "Grade 7"],
  ["new-price", "Grade 8"],
  ["graded-price", "Grade 9"],
  ["box-only-price", "Grade 9.5"],
  ["manual-only-price", "PSA 10"],
  ["bgs-10-price", "BGS 10"],
  ["condition-17-price", "CGC 10"],
  ["condition-18-price", "SGC 10"],
  ["condition-19-price", "CGC 10 Pristine"],
  ["condition-20-price", "BGS 10 Black Label"],
  ["condition-21-price", "TAG 10"],
];

/**
 * PriceCharting allows one call a second and revokes a key that keeps
 * exceeding it. A whole-collection refresh runs a few cards at once and each
 * lookup can make two calls, so the pacing is one shared queue for the whole
 * process rather than per lookup. On the global object, like the database
 * handle: a development reload that made a fresh limiter would forget the
 * call just made.
 */
const globalForLimiter = globalThis as unknown as { __cardsPriceChartingLimiter?: RateLimit };
let limiter: RateLimit = (globalForLimiter.__cardsPriceChartingLimiter ??= rateLimit(1, 1000));

/** Tests only: replace the shared limit so a test does not wait a real second. */
export function setPriceChartingLimit(next: RateLimit): void {
  limiter = globalForLimiter.__cardsPriceChartingLimiter = next;
}

/** One paced request; a refusal pauses every PriceCharting call for as long as it asks. */
async function paced(fetchImpl: typeof fetch, url: string, signal?: AbortSignal): Promise<Response> {
  await limiter.take(signal);
  if (signal?.aborted) throw new ProviderError("pricecharting", "Gave up waiting for a turn to ask PriceCharting.");
  const res = await fetchImpl(url, { signal });
  if (res.status === 429) {
    const wait = retryAfterMs(res.headers.get("retry-after"), Date.now(), 60_000);
    limiter.cooldown(wait);
    throw new ProviderError("pricecharting", `PriceCharting is rate limiting this app; every PriceCharting lookup waits ${Math.ceil(wait / 1000)} seconds before asking again.`);
  }
  return res;
}

export function buildSearch(q: CardQuery): string {
  const num = numberPart(q.cardNumber);
  const parts: string[] = [];
  if (q.game === "sports") {
    if (q.year) parts.push(String(q.year));
    if (q.manufacturer && !(q.setName ?? "").toLowerCase().includes(q.manufacturer.toLowerCase())) parts.push(q.manufacturer);
    if (q.setName) parts.push(q.setName);
    parts.push(q.name);
    if (num) parts.push(`#${num}`);
    // A named parallel is its own product on PriceCharting ("Gold Refractor"),
    // so it goes into the search; a plain variant word like "auto" does too.
    if (q.parallel) parts.push(q.parallel);
  } else {
    parts.push(q.name);
    if (num) parts.push(`#${num}`);
    if (q.setName) parts.push(q.setName);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const CATEGORY_HINTS: Record<Game, string[]> = {
  pokemon: ["pokemon"],
  yugioh: ["yugioh", "yu-gi-oh"],
  mtg: ["magic"],
  sports: ["baseball", "basketball", "football", "hockey", "soccer", "topps", "panini", "bowman", "upper", "fleer", "donruss", "wrestling", "golf", "racing", "ufc"],
  other: [],
};

export function scoreProduct(q: CardQuery, p: PcProduct): number {
  const productName = p["product-name"];
  const console = p["console-name"];
  let score = tokenOverlap(q.name, productName) * 4;
  const pnum = productName.match(/#\s*([A-Za-z0-9-]+)/)?.[1] ?? null;
  if (q.cardNumber) {
    if (sameNumber(q.cardNumber, pnum)) score += 3;
    else if (pnum) score -= 2;
  }
  if (q.setName) score += setSimilarity(q.setName, console.replace(/^(pokemon|yugioh|magic)\s+/i, "")) * 3;
  if (q.year && (console.includes(String(q.year)) || p["release-date"]?.startsWith(String(q.year)))) score += 1;
  if (q.manufacturer) score += tokenOverlap(q.manufacturer, console);
  const consoleTokens = new Set(tokens(console));
  if (CATEGORY_HINTS[q.game].some((h) => consoleTokens.has(h) || console.toLowerCase().includes(h))) score += 1;
  const v = `${q.variant ?? ""} ${q.parallel ?? ""}`.toLowerCase();
  const pn = productName.toLowerCase();
  for (const kw of ["reverse", "holo", "1st edition", "shadowless", "refractor", "auto", "foil", "parallel"]) {
    if (v.includes(kw) && pn.includes(kw)) score += 0.5;
    if (!v.includes(kw) && pn.includes(kw) && kw !== "holo") score -= 0.5;
  }
  // A parallel's own words ("gold", "prizm") count when the copy has them and against it when it does not.
  for (const word of tokens(q.parallel)) if (pn.includes(word)) score += 0.5;
  return score;
}

function cents(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? round2(n / 100) : null;
}

export function productToQuote(p: PcProduct, fetchedAt = new Date().toISOString()): PriceQuote {
  const graded: Record<string, number> = {};
  for (const [field, label] of GRADED_FIELDS) {
    const v = cents(p[field]);
    if (v) graded[label] = v;
  }
  return {
    source: "pricecharting",
    sourceLabel: "PriceCharting",
    currency: "USD",
    url: productUrl(p),
    matchedName: p["product-name"],
    matchedDetail: p["console-name"],
    ungraded: cents(p["loose-price"]),
    ungradedVariants: {},
    graded,
    fetchedAt,
    externalId: p.id,
  };
}

export const priceChartingProvider: PriceProvider = {
  id: "pricecharting",
  label: "PriceCharting",
  games: ["pokemon", "yugioh", "mtg", "sports", "other"],
  optional: true,
  note: "Set PRICECHARTING_TOKEN (paid API) to get graded PSA/BGS/CGC/SGC prices for every category. The only sports-card price source; there is no free sports API.",
  isConfigured: isPriceChartingConfigured,
  async lookup(q, fetchImpl = fetch, signal?: AbortSignal) {
    const token = priceChartingToken();
    if (!token) return [];
    const pacedFetch = (url: string | URL) => paced(fetchImpl, String(url), signal);
    const knownId = q.externalIds?.pricecharting;
    if (knownId) {
      const product = await fetchProduct(token, knownId, pacedFetch as typeof fetch);
      if (product) return [productToQuote(product)];
    }
    let products: PcProduct[];
    try {
      products = await searchProducts(token, buildSearch(q), pacedFetch as typeof fetch);
    } catch (e) {
      if (e instanceof PriceChartingError) throw new ProviderError("pricecharting", e.message);
      throw e;
    }
    if (products.length === 0) return [];
    const top = products.map((p) => ({ p, s: scoreProduct(q, p) })).sort((a, b) => b.s - a.s)[0];
    // Half the name's words alone score 2, and a category word 1: a product
    // sharing one word of a two-word name used to pass. Four is the whole
    // name, or half of it plus the number or the set agreeing.
    if (!top || top.s < 4 || tokenOverlap(q.name, top.p["product-name"]) < 0.5) return []; // nothing that plausibly matches
    return [productToQuote(top.p)];
  },
};
