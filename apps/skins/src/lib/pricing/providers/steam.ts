import type { PriceQuote } from "../../types";
import { rateLimit, type RateLimit } from "../limiter";
import { ProviderError, type ItemQuery, type PriceProvider } from "../types";

/**
 * The Steam Community Market's own price overview.
 *
 * One request per item, and roughly twenty a minute before Steam starts
 * refusing — the opposite shape to Skinport, and the reason the shared limiter
 * exists. Pricing a large inventory through this alone is slow by design; it is
 * worth having anyway, because Steam is where the largest share of CS2 trading
 * actually happens and no other source can speak for it.
 *
 * What it pays is a different question from what it lists, and one this
 * provider deliberately does not answer: the fee is applied elsewhere, so the
 * number recorded here is the same kind of number every other source gives.
 */

const ENDPOINT = "https://steamcommunity.com/market/priceoverview/";
/** Steam's currency ids; 1 is USD. */
const USD = 1;

/** Steam's published guidance is twenty a minute; this stays under it. */
export const STEAM_LIMIT = { max: 18, windowMs: 60_000 };

let limiter: RateLimit = rateLimit(STEAM_LIMIT.max, STEAM_LIMIT.windowMs);

/** Tests only: replace the shared limit so a test does not wait a real minute. */
export function setRateLimit(next: RateLimit): void {
  limiter = next;
}

export interface SteamPriceOverview {
  success?: boolean;
  lowest_price?: string;
  median_price?: string;
  volume?: string;
}

/** "$1,234.56" and "1.234,56€" both mean a number. */
export function parseSteamPrice(text: string | undefined): number | null {
  if (!text) return null;
  // Strip everything but digits and separators, then work out which separator
  // is the decimal one by which comes last.
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else normalized = cleaned.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseVolume(text: string | undefined): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export const steam: PriceProvider = {
  id: "steam",
  label: "Steam Community Market",
  optional: true,
  note: "No key needed, but answers about twenty times a minute, so a large inventory takes a while.",

  isConfigured: () => true,

  async lookup(query: ItemQuery, fetchImpl: typeof fetch = fetch): Promise<PriceQuote[]> {
    await limiter.take();
    const url = `${ENDPOINT}?appid=730&currency=${USD}&market_hash_name=${encodeURIComponent(query.marketHashName)}`;
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      throw new ProviderError("steam", `Could not reach Steam: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (response.status === 429) {
      throw new ProviderError("steam", "Steam is rate limiting this address. It allows about twenty requests a minute.");
    }
    if (!response.ok) throw new ProviderError("steam", `Steam answered ${response.status}.`);

    const body = (await response.json()) as SteamPriceOverview;
    // Steam answers 200 with success: false for a name it does not list, which
    // is an ordinary answer rather than a failure.
    if (!body?.success) return [];

    // The lowest ask is what an item can be bought for now. The median is what
    // it has been selling for, which is the better guide when nobody is
    // currently listing one.
    const price = parseSteamPrice(body.lowest_price) ?? parseSteamPrice(body.median_price);
    if (price === null) return [];

    return [
      {
        source: "steam",
        sourceLabel: parseSteamPrice(body.lowest_price) === null ? "Steam (median of recent sales)" : "Steam",
        currency: "USD",
        url: `https://steamcommunity.com/market/listings/730/${encodeURIComponent(query.marketHashName)}`,
        matchedName: query.marketHashName,
        price,
        volume: parseVolume(body.volume),
        fetchedAt: new Date().toISOString(),
      },
    ];
  },
};
