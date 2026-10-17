import { rateLimit, retryAfterMs, type RateLimit } from "../limiter";
import { round2, tokenOverlap, tokens } from "./match";

/**
 * The PriceCharting API (https://www.pricecharting.com/api-documentation),
 * shared by every domain app that prices against it.
 *
 * One paid token covers every category they publish — video games, trading
 * cards, comic books and more — and every category answers with the same
 * product shape. What differs is what the price fields *mean*: for a game
 * `cib-price` is a complete-in-box copy, for a card it is a Grade 7, for a
 * comic a Grade 4.0. So the HTTP client, the cents conversion and the ranking
 * live here, and each app supplies its own field mapping.
 *
 * Prices come back in cents.
 *
 * The card app keeps its own client (apps/cards/src/lib/pricing/providers/
 * pricecharting.ts) with its card-specific mapping and ranking. The two ask
 * PriceCharting the same way, at the same pace, and know the same price
 * fields; a change to either is made to both.
 */

export interface PcProduct {
  id: string;
  "product-name": string;
  "console-name": string;
  "release-date"?: string;
  genre?: string;
  "loose-price"?: number;
  "cib-price"?: number;
  "new-price"?: number;
  "graded-price"?: number;
  "box-only-price"?: number;
  "manual-only-price"?: number;
  "bgs-10-price"?: number;
  "condition-17-price"?: number;
  "condition-18-price"?: number;
  "condition-19-price"?: number;
  "condition-20-price"?: number;
  "condition-21-price"?: number;
  "retail-loose-buy"?: number;
  "retail-loose-sell"?: number;
  "retail-cib-buy"?: number;
  "retail-cib-sell"?: number;
  "retail-new-buy"?: number;
  "retail-new-sell"?: number;
}

/**
 * Every field that can hold a price, in the order PriceCharting lists them.
 * For trading cards the last six are the agencies' 10s: bgs-10 is a BGS 10,
 * condition-17 a CGC 10, 18 an SGC 10, 19 a CGC 10 Pristine, 20 a BGS 10
 * Black Label and 21 a TAG 10.
 */
export type PcPriceField =
  | "loose-price"
  | "cib-price"
  | "new-price"
  | "graded-price"
  | "box-only-price"
  | "manual-only-price"
  | "bgs-10-price"
  | "condition-17-price"
  | "condition-18-price"
  | "condition-19-price"
  | "condition-20-price"
  | "condition-21-price";

export const PC_PRICE_FIELDS: PcPriceField[] = [
  "loose-price",
  "cib-price",
  "new-price",
  "graded-price",
  "box-only-price",
  "manual-only-price",
  "bgs-10-price",
  "condition-17-price",
  "condition-18-price",
  "condition-19-price",
  "condition-20-price",
  "condition-21-price",
];

export class PriceChartingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceChartingError";
  }
}

export const PRICECHARTING_TOKEN_ENV = "PRICECHARTING_TOKEN";

export function priceChartingToken(): string | null {
  return process.env[PRICECHARTING_TOKEN_ENV] || null;
}

export function isPriceChartingConfigured(): boolean {
  return Boolean(priceChartingToken());
}

/** Cents to dollars, or null for a missing or zero price: PriceCharting writes 0 for "no data". */
export function cents(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? round2(n / 100) : null;
}

/** Where a person would land to check this product. */
export function productUrl(p: PcProduct): string {
  return `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(`${p["product-name"]} ${p["console-name"]}`)}`;
}

/** Read the prices out of a product by a per-category mapping of field -> label. */
export function pricesFrom(p: PcProduct, mapping: Array<[PcPriceField, string]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [field, label] of mapping) {
    const v = cents(p[field]);
    if (v) out[label] = v;
  }
  return out;
}

/**
 * PriceCharting allows one call a second and revokes a key that keeps
 * exceeding it. A refresh runs a few items at once and each lookup can make
 * two calls, so the pacing is one queue for the whole process rather than
 * one per lookup. It lives on the global object, like a database handle,
 * because a bundler can load this module more than once (a route and a page
 * each get a copy) and a development reload makes a fresh one: a limiter per
 * copy would each think it had the whole budget. It is read from there on
 * every call, so a copy loaded later sees a limit a test replaced.
 */
const globalForLimiter = globalThis as unknown as { __priceChartingLimiter?: RateLimit };

function limiter(): RateLimit {
  return (globalForLimiter.__priceChartingLimiter ??= rateLimit(1, 1000));
}

/** Tests only: replace the shared limit so a test does not wait a real second. */
export function setPriceChartingLimit(next: RateLimit): void {
  globalForLimiter.__priceChartingLimiter = next;
}

/**
 * One paced request. A refusal pauses every PriceCharting call, from every
 * lookup, for as long as it asks (a minute when it does not say), rather than
 * letting each queued call collect a refusal of its own. An aborted signal
 * ends the wait for a turn, so a lookup that was given up on does not ask
 * PriceCharting anything later.
 */
async function paced(fetchImpl: typeof fetch, url: string, signal?: AbortSignal): Promise<Response> {
  await limiter().take(signal);
  if (signal?.aborted) throw new PriceChartingError("Gave up waiting for a turn to ask PriceCharting.");
  const res = await fetchImpl(url, { signal });
  if (res.status === 429) {
    const wait = retryAfterMs(res.headers.get("retry-after"), Date.now(), 60_000);
    limiter().cooldown(wait);
    throw new PriceChartingError(`PriceCharting is rate limiting this app; every PriceCharting lookup waits ${Math.ceil(wait / 1000)} seconds before asking again.`);
  }
  return res;
}

/**
 * Fetch one product by its PriceCharting id. Null when it is not there or
 * the request failed; a refusal to serve this app at this pace is an error.
 */
export async function fetchProduct(token: string, id: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<PcProduct | null> {
  const res = await paced(fetchImpl, `https://www.pricecharting.com/api/product?t=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}`, signal);
  if (!res.ok) return null;
  const body = (await res.json()) as PcProduct & { status?: string };
  return body.status === "success" && body["product-name"] ? body : null;
}

/**
 * Search for products. PriceCharting answers with up to twenty candidates
 * across every category, so callers rank them with `scoreProduct` or their
 * own scoring and keep the best.
 */
export async function searchProducts(token: string, query: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<PcProduct[]> {
  const res = await paced(fetchImpl, `https://www.pricecharting.com/api/products?t=${encodeURIComponent(token)}&q=${encodeURIComponent(query)}`, signal);
  if (!res.ok) throw new PriceChartingError(`PriceCharting returned HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; products?: PcProduct[]; "error-message"?: string };
  if (body.status && body.status !== "success") {
    throw new PriceChartingError(body["error-message"] ?? `PriceCharting error: ${body.status}`);
  }
  return body.products ?? [];
}

export interface ProductMatch {
  /** The thing's own name, matched against the product name. */
  name: string;
  /** Words expected in the console-name (a platform, a publisher, a set). */
  consoleHints?: string[];
  /** A year the product should carry, in its console name or release date. */
  year?: number | null;
  /** Words that should appear in the product name when the copy has them and count against it when it does not. */
  variantWords?: string[];
}

/**
 * A generic ranking: how much of the name matches, whether the console name
 * agrees with what the caller expected, and whether the year lines up. Apps
 * with more structure (a collector number, a set) add their own terms on top.
 */
export function scoreProduct(q: ProductMatch, p: PcProduct): number {
  const productName = p["product-name"];
  const console = p["console-name"];
  let score = tokenOverlap(q.name, productName) * 4;
  const consoleTokens = new Set(tokens(console));
  for (const hint of q.consoleHints ?? []) {
    if (tokens(hint).every((t) => consoleTokens.has(t))) score += 2;
    else if (tokens(hint).some((t) => consoleTokens.has(t))) score += 0.5;
  }
  if (q.year && (console.includes(String(q.year)) || p["release-date"]?.startsWith(String(q.year)))) score += 1;
  const pn = productName.toLowerCase();
  // Single letters ("s" from an apostrophe) match anything and say nothing.
  const words = (q.variantWords ?? []).filter((w) => w.length > 1);
  if (words.length) {
    // A copy that says which variant it is should land on the listing that says so, year or no year.
    const hits = words.filter((w) => pn.includes(w.toLowerCase())).length;
    score += (hits / words.length) * 2;
  } else if (/\[[^\]]+\]/.test(productName)) {
    // PriceCharting brackets a variant ("[Player's Choice]", "[Not for Resale]",
    // "[Newsstand]"); a plain copy should not be priced off one.
    score -= 1;
  }
  return score;
}

/** The best candidate, or null when nothing plausibly matches. */
export function bestProduct<T extends PcProduct>(products: T[], score: (p: T) => number, floor = 1.5): T | null {
  const top = products.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s)[0];
  return top === undefined || top.s < floor ? null : top.p;
}
