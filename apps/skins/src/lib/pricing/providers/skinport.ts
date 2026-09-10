import type { PriceQuote } from "../../types";
import { ProviderError, type ItemQuery, type PriceProvider } from "../types";

/**
 * Skinport's public catalogue.
 *
 * One request returns every CS2 item they list with a price, which is why this
 * provider exists in the shape it does: for an inventory of any size it is a
 * single call rather than one per item. Skinport cache their own answer for
 * five minutes and ask callers not to poll faster, so this holds it for the
 * same five minutes and every lookup in a refresh reads from that.
 *
 * No key is needed. `min_price` is what an item can actually be bought for
 * right now, which is the number worth recording; `suggested_price` is
 * Skinport's own estimate and is deliberately not used, because a price nobody
 * is offering is not a price.
 */

const ENDPOINT = "https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0";

/** Skinport refresh their own cache every five minutes; asking faster returns the same answer. */
export const CATALOGUE_TTL_MS = 5 * 60_000;

export interface SkinportItem {
  market_hash_name?: string;
  currency?: string;
  min_price?: number | null;
  median_price?: number | null;
  mean_price?: number | null;
  suggested_price?: number | null;
  quantity?: number;
  item_page?: string;
  market_page?: string;
  updated_at?: number;
}

interface Catalogue {
  at: number;
  byName: Map<string, SkinportItem>;
}

// One catalogue per process, kept across Next's development module reloads.
const globalForSkinport = globalThis as unknown as { __skinportCatalogue?: Catalogue };

/** Tests only: forget the loaded catalogue. */
export function resetCatalogue(): void {
  globalForSkinport.__skinportCatalogue = undefined;
}

function fresh(now: number): Catalogue | null {
  const held = globalForSkinport.__skinportCatalogue;
  return held && now - held.at < CATALOGUE_TTL_MS ? held : null;
}

async function load(fetchImpl: typeof fetch, now: number): Promise<Catalogue> {
  const held = fresh(now);
  if (held) return held;

  let response: Response;
  try {
    // Skinport ask for a compressed response; Node's fetch negotiates and
    // decodes it without anything else being needed here.
    response = await fetchImpl(ENDPOINT, { headers: { Accept: "application/json", "Accept-Encoding": "br, gzip" } });
  } catch (e) {
    throw new ProviderError("skinport", `Could not reach Skinport: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (response.status === 429) {
    throw new ProviderError("skinport", "Skinport is rate limiting this address. Their prices only change every five minutes.");
  }
  if (!response.ok) throw new ProviderError("skinport", `Skinport answered ${response.status}.`);

  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) throw new ProviderError("skinport", "Skinport returned something that was not a list of items.");

  const byName = new Map<string, SkinportItem>();
  for (const entry of body as SkinportItem[]) {
    if (entry?.market_hash_name) byName.set(entry.market_hash_name, entry);
  }
  if (byName.size === 0) throw new ProviderError("skinport", "Skinport returned an empty catalogue.");

  const catalogue: Catalogue = { at: now, byName };
  globalForSkinport.__skinportCatalogue = catalogue;
  return catalogue;
}

export const skinport: PriceProvider = {
  id: "skinport",
  label: "Skinport",
  optional: true,
  note: "No key needed. Returns the whole catalogue in one request, so a large inventory costs one call.",

  isConfigured: () => true,

  async prime(fetchImpl: typeof fetch = fetch) {
    await load(fetchImpl, Date.now());
  },

  async lookup(query: ItemQuery, fetchImpl: typeof fetch = fetch): Promise<PriceQuote[]> {
    const catalogue = await load(fetchImpl, Date.now());
    const entry = catalogue.byName.get(query.marketHashName);
    // Not being listed is an ordinary answer, not a failure: plenty of items
    // have nobody selling them at this moment.
    if (!entry) return [];
    const price = typeof entry.min_price === "number" && entry.min_price > 0 ? entry.min_price : null;
    if (price === null) return [];
    return [
      {
        source: "skinport",
        sourceLabel: "Skinport",
        currency: "USD",
        url: entry.item_page ?? entry.market_page ?? null,
        matchedName: entry.market_hash_name ?? query.marketHashName,
        price,
        volume: typeof entry.quantity === "number" ? entry.quantity : null,
        fetchedAt: new Date(catalogue.at).toISOString(),
      },
    ];
  },
};
