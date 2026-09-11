import type { PriceQuote } from "../../types";
import { rateLimit, type RateLimit } from "@collectcollect/core/limiter";
import { ProviderError, type ItemQuery, type PriceProvider } from "../types";

/**
 * CSFloat's marketplace listings.
 *
 * The only one of the three that needs a key, and the only one that knows an
 * item's float without the game running — which is why it is worth wiring up
 * even though its prices sit close to Skinport's. Set CSFLOAT_API_KEY to turn
 * it on; without one this provider says so rather than quietly not appearing,
 * so a missing price is never mistaken for a missing market.
 */

const ENDPOINT = "https://csfloat.com/api/v1/listings";

/** Their documented ceiling is generous; this stays well inside it. */
let limiter: RateLimit = rateLimit(60, 60_000);

/** Tests only: replace the shared limit so a test does not wait. */
export function setRateLimit(next: RateLimit): void {
  limiter = next;
}

export interface CsFloatListing {
  /** Cents, not dollars. */
  price?: number;
  id?: string;
  item?: { market_hash_name?: string; float_value?: number; paint_seed?: number };
}

export const csfloat: PriceProvider = {
  id: "csfloat",
  label: "CSFloat",
  optional: true,
  note: "Needs CSFLOAT_API_KEY. Also the only source that knows an item's float without inspecting it in game.",

  isConfigured: () => Boolean(process.env.CSFLOAT_API_KEY),

  async lookup(query: ItemQuery, fetchImpl: typeof fetch = fetch): Promise<PriceQuote[]> {
    const key = process.env.CSFLOAT_API_KEY;
    if (!key) return [];
    await limiter.take();

    const url = `${ENDPOINT}?market_hash_name=${encodeURIComponent(query.marketHashName)}&sort_by=lowest_price&limit=1`;
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "application/json", Authorization: key } });
    } catch (e) {
      throw new ProviderError("csfloat", `Could not reach CSFloat: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("csfloat", "CSFloat refused that key.");
    }
    if (response.status === 429) {
      throw new ProviderError("csfloat", "CSFloat is rate limiting this address.");
    }
    if (!response.ok) throw new ProviderError("csfloat", `CSFloat answered ${response.status}.`);

    const body = (await response.json()) as { data?: CsFloatListing[] } | CsFloatListing[];
    const listings = Array.isArray(body) ? body : (body?.data ?? []);
    const first = listings[0];
    if (!first || typeof first.price !== "number") return [];

    return [
      {
        source: "csfloat",
        sourceLabel: "CSFloat",
        currency: "USD",
        url: first.id ? `https://csfloat.com/item/${first.id}` : "https://csfloat.com",
        matchedName: first.item?.market_hash_name ?? query.marketHashName,
        // Their prices are in cents.
        price: first.price / 100,
        volume: null,
        fetchedAt: new Date().toISOString(),
      },
    ];
  },
};
