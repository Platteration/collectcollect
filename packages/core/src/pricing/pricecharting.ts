import { round2, tokenOverlap, tokens } from "./match";

/**
 * The PriceCharting API (https://www.pricecharting.com/api-documentation),
 * shared by every app that prices against it.
 *
 * One paid token covers every category they publish — video games, trading
 * cards, comic books and more — and every category answers with the same
 * product shape. What differs is what the price fields *mean*: for a game
 * `cib-price` is a complete-in-box copy, for a card it is a Grade 7, for a
 * comic a Grade 4.0. So the HTTP client, the cents conversion and the ranking
 * live here, and each app supplies its own field mapping.
 *
 * Prices come back in cents.
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
  "retail-loose-buy"?: number;
  "retail-loose-sell"?: number;
  "retail-cib-buy"?: number;
  "retail-cib-sell"?: number;
  "retail-new-buy"?: number;
  "retail-new-sell"?: number;
}

/** Every field that can hold a price, in the order PriceCharting lists them. */
export type PcPriceField =
  | "loose-price"
  | "cib-price"
  | "new-price"
  | "graded-price"
  | "box-only-price"
  | "manual-only-price"
  | "bgs-10-price"
  | "condition-17-price"
  | "condition-18-price";

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

/** Fetch one product by its PriceCharting id. Null when it is not there or the request failed. */
export async function fetchProduct(token: string, id: string, fetchImpl: typeof fetch = fetch): Promise<PcProduct | null> {
  const res = await fetchImpl(`https://www.pricecharting.com/api/product?t=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as PcProduct & { status?: string };
  return body.status === "success" && body["product-name"] ? body : null;
}

/**
 * Search for products. PriceCharting answers with up to twenty candidates
 * across every category, so callers rank them with `scoreProduct` or their
 * own scoring and keep the best.
 */
export async function searchProducts(token: string, query: string, fetchImpl: typeof fetch = fetch): Promise<PcProduct[]> {
  const res = await fetchImpl(`https://www.pricecharting.com/api/products?t=${encodeURIComponent(token)}&q=${encodeURIComponent(query)}`);
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
  if (products.length === 0) return null;
  const ranked = products.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s);
  return ranked[0].s < floor ? null : ranked[0].p;
}
