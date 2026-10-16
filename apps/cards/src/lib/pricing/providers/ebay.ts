import type { PriceQuote } from "../../types";
import type { CardQuery, PriceProvider } from "../types";
import { ProviderError } from "../types";
import { numberPart, round2, tokenOverlap, toNumber } from "../match";

/**
 * eBay sold listings via the Marketplace Insights API
 * (https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html).
 * Requires an eBay developer app: EBAY_CLIENT_ID + EBAY_CLIENT_SECRET with the
 * `buy.marketplace.insights` scope. Inert without both credentials.
 *
 * The endpoint answers with items actually sold in the last 90 days, which is
 * noisier than a price guide's curated figure — a mis-titled listing, a lot,
 * or a shill bid all land in the same list — so each figure here is the
 * median of the plausible sales, never the mean.
 *
 * Wiring note: `PriceSource` in ../../types does not yet include "ebay". The
 * parent change that registers this provider adds `"ebay"` to `PriceSource`
 * (and to PROVIDERS / SOURCE_PRIORITY in ../index, provider-check, and
 * .env.example). Until then the id is held in EBAY_SOURCE_ID and cast at the
 * two places a PriceSource is required; both casts can be dropped once the
 * union knows the value.
 */
export const EBAY_SOURCE_ID = "ebay" as const;
export type EbaySourceId = typeof EBAY_SOURCE_ID;

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SALES_URL = "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
const SALES_LIMIT = 50;

/** One sold item as Marketplace Insights reports it. */
export interface EbayItemSale {
  itemId?: string;
  title?: string;
  itemWebUrl?: string;
  lastSoldPrice?: { value?: string | number; currency?: string };
  /** Some responses nest the price under `price` instead; tolerated on read. */
  price?: { value?: string | number; currency?: string };
  lastSoldDate?: string;
}

export interface EbaySalesResponse {
  total?: number;
  itemSales?: EbayItemSale[];
}

interface EbayCredentials {
  clientId: string;
  clientSecret: string;
}

export function ebayCredentials(): EbayCredentials | null {
  const clientId = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Key-gated: true only when both eBay credentials are set. */
export function isEbayConfigured(): boolean {
  return ebayCredentials() !== null;
}

/** The Marketplace Insights search text: name, set, and card number. */
export function buildQuery(q: CardQuery): string {
  const parts: string[] = [q.name];
  if (q.setName) parts.push(q.setName);
  const num = numberPart(q.cardNumber);
  if (num) parts.push(num);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function buildSalesUrl(q: CardQuery): string {
  const params = new URLSearchParams({ q: buildQuery(q), limit: String(SALES_LIMIT) });
  return `${SALES_URL}?${params}`;
}

/**
 * The grade a sale title names, keyed the way summarize() expects:
 * "PSA 10", "BGS 9.5", "CGC 10", "SGC 9", or a bare "Grade 9" when the
 * title gives a grade with no company. Null when the title names none.
 */
export function parseGrade(title: string | null | undefined): string | null {
  if (!title) return null;
  const labelled = title.match(/\b(PSA|BGS|CGC|SGC)\s*(?:grade\s*)?(?:gem\s*mint\s*)?(\d+(?:\.\d+)?)\b/i);
  if (labelled?.[1] && labelled[2]) {
    const value = Number(labelled[2]);
    if (Number.isFinite(value) && value >= 1 && value <= 10) return `${labelled[1].toUpperCase()} ${String(value)}`;
  }
  const bare = title.match(/\bgrade\s*(\d+(?:\.\d+)?)\b/i);
  if (!bare?.[1]) return null;
  const value = Number(bare[1]);
  if (!Number.isFinite(value) || value < 1 || value > 10) return null;
  return `Grade ${String(value)}`;
}

/** Median of a non-empty list, rounded to cents; null for an empty one. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return round2(value);
}

function salePrice(sale: EbayItemSale): number | null {
  const price = sale.lastSoldPrice ?? sale.price;
  if (!price) return null;
  // The quote is USD; a sale priced in another currency is not evidence for it.
  if (price.currency && price.currency.toUpperCase() !== "USD") return null;
  return toNumber(price.value);
}

/** Whether a sale title plausibly names the card asked about. */
export function isPlausibleSale(q: CardQuery, sale: EbayItemSale): boolean {
  return Boolean(sale.title) && tokenOverlap(q.name, sale.title) >= 0.5;
}

/**
 * Fold the plausible sales into one quote: the median ungraded price and the
 * median price per grade. Null when no sale is both plausible and priced.
 */
export function salesToQuote(q: CardQuery, sales: EbayItemSale[], fetchedAt = new Date().toISOString()): PriceQuote | null {
  const ungradedPrices: number[] = [];
  const gradedPrices = new Map<string, number[]>();
  let plausible = 0;
  for (const sale of sales) {
    if (!isPlausibleSale(q, sale)) continue;
    const price = salePrice(sale);
    if (price === null) continue;
    plausible += 1;
    const grade = parseGrade(sale.title);
    if (grade === null) {
      ungradedPrices.push(price);
    } else {
      const list = gradedPrices.get(grade) ?? [];
      list.push(price);
      gradedPrices.set(grade, list);
    }
  }
  if (plausible === 0) return null;
  const graded: Record<string, number> = {};
  for (const [grade, prices] of gradedPrices) {
    const value = median(prices);
    if (value !== null) graded[grade] = value;
  }
  const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery(q))}&LH_Sold=1&LH_Complete=1`;
  return {
    // Cast: "ebay" joins PriceSource when the parent wires this provider in.
    source: EBAY_SOURCE_ID as PriceQuote["source"],
    sourceLabel: "eBay sold listings",
    currency: "USD",
    url: searchUrl,
    matchedName: q.name,
    matchedDetail: `${plausible} sold listing${plausible === 1 ? "" : "s"} in the last 90 days`,
    ungraded: median(ungradedPrices),
    ungradedVariants: {},
    graded,
    fetchedAt,
  };
}

async function fetchAccessToken(
  credentials: EbayCredentials,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: OAUTH_SCOPE }).toString(),
      signal,
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(EBAY_SOURCE_ID, `eBay sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new ProviderError(EBAY_SOURCE_ID, `eBay OAuth returned HTTP ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new ProviderError(EBAY_SOURCE_ID, "eBay OAuth returned no access token");
  return body.access_token;
}

export const ebayProvider: PriceProvider = {
  // Cast: "ebay" joins PriceSource when the parent wires this provider in.
  id: EBAY_SOURCE_ID as PriceProvider["id"],
  label: "eBay sold listings",
  games: ["pokemon", "yugioh", "mtg", "sports", "other"],
  optional: true,
  note: "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (eBay developer app, buy.marketplace.insights scope) to price from sold listings of the last 90 days.",
  isConfigured: isEbayConfigured,
  async lookup(q, fetchImpl = fetch, signal?: AbortSignal) {
    const credentials = ebayCredentials();
    if (!credentials) return [];
    const token = await fetchAccessToken(credentials, fetchImpl, signal);
    let res: Response;
    try {
      res = await fetchImpl(buildSalesUrl(q), {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal,
      });
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(EBAY_SOURCE_ID, `eBay sold-listings request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new ProviderError(EBAY_SOURCE_ID, `eBay Marketplace Insights returned HTTP ${res.status}`);
    const body = (await res.json()) as EbaySalesResponse;
    const quote = salesToQuote(q, body.itemSales ?? []);
    return quote ? [quote] : [];
  },
};
