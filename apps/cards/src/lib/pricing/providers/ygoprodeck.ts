import type { PriceQuote } from "../../types";
import type { CardQuery, PriceProvider } from "../types";
import { ProviderError } from "../types";
import { round2, toNumber, tokenOverlap } from "../match";

/**
 * YGOPRODeck (https://ygoprodeck.com/api-guide/). Free, no key.
 * Returns TCGplayer / Cardmarket / eBay / Amazon prices for raw cards, plus a
 * per-set price when the set code is known.
 */

interface YgoCard {
  id: number;
  name: string;
  type?: string;
  card_sets?: Array<{ set_name: string; set_code: string; set_rarity: string; set_price?: string }>;
  card_images?: Array<{ image_url?: string; image_url_small?: string }>;
  card_prices?: Array<{
    cardmarket_price?: string;
    tcgplayer_price?: string;
    ebay_price?: string;
    amazon_price?: string;
    coolstuffinc_price?: string;
  }>;
  ygoprodeck_url?: string;
}

const BASE = "https://db.ygoprodeck.com/api/v7/cardinfo.php";

export function findSet(card: YgoCard, q: CardQuery) {
  const sets = card.card_sets ?? [];
  const code = (q.setCode ?? q.cardNumber ?? "").toUpperCase().trim();
  if (code) {
    const exact = sets.find((s) => s.set_code.toUpperCase() === code);
    if (exact) return exact;
    const prefix = code.split("-")[0];
    const byPrefix = sets.filter((s) => s.set_code.toUpperCase().startsWith(prefix + "-"));
    if (byPrefix.length === 1) return byPrefix[0];
  }
  if (q.setName) {
    const top = sets
      .map((s) => ({ s, score: tokenOverlap(q.setName, s.set_name) }))
      .sort((a, b) => b.score - a.score)[0];
    if (top && top.score >= 0.5) return top.s;
  }
  return null;
}

export const ygoprodeckProvider: PriceProvider = {
  id: "ygoprodeck",
  label: "YGOPRODeck",
  games: ["yugioh"],
  optional: true,
  note: "Free, no key required.",
  isConfigured: () => true,
  async lookup(q, fetchImpl = fetch) {
    let cards: YgoCard[] = [];
    const exact = await fetchImpl(`${BASE}?name=${encodeURIComponent(q.name)}`);
    if (exact.ok) cards = ((await exact.json()) as { data?: YgoCard[] }).data ?? [];
    if (cards.length === 0) {
      const fuzzy = await fetchImpl(`${BASE}?fname=${encodeURIComponent(q.name)}&num=20&offset=0`);
      if (fuzzy.status === 400) return []; // YGOPRODeck answers 400 for "no cards matching"
      if (!fuzzy.ok) throw new ProviderError("ygoprodeck", `YGOPRODeck returned HTTP ${fuzzy.status}`);
      cards = ((await fuzzy.json()) as { data?: YgoCard[] }).data ?? [];
    }
    if (cards.length === 0) return [];

    const top = cards
      .map((c) => ({ c, s: (c.name.toLowerCase() === q.name.toLowerCase() ? 3 : 0) + tokenOverlap(q.name, c.name) }))
      .sort((a, b) => b.s - a.s)[0];
    if (!top) return [];
    const best = top.c;
    const set = findSet(best, q);
    const prices = best.card_prices?.[0] ?? {};
    const variants: Record<string, number> = {};
    const add = (label: string, v: unknown) => {
      const n = toNumber(v);
      if (n) variants[label] = round2(n);
    };
    add("TCGplayer", prices.tcgplayer_price);
    add("eBay", prices.ebay_price);
    add("Amazon", prices.amazon_price);
    add("CoolStuffInc", prices.coolstuffinc_price);
    if (set?.set_price) add(`This set (${set.set_code})`, set.set_price);

    const ungraded = toNumber(set?.set_price) ?? toNumber(prices.tcgplayer_price) ?? toNumber(prices.ebay_price);
    const fetchedAt = new Date().toISOString();
    const quotes: PriceQuote[] = [
      {
        source: "ygoprodeck",
        sourceLabel: "YGOPRODeck (TCGplayer / eBay)",
        currency: "USD",
        url: best.ygoprodeck_url ?? `https://ygoprodeck.com/card/?search=${encodeURIComponent(best.name)}`,
        matchedName: best.name,
        matchedDetail: set ? `${set.set_name} · ${set.set_code} · ${set.set_rarity}` : (best.type ?? null),
        ungraded: ungraded ? round2(ungraded) : null,
        ungradedVariants: variants,
        graded: {},
        fetchedAt,
        externalId: String(best.id),
        referenceImageUrl: best.card_images?.[0]?.image_url ?? null,
      },
    ];
    const cm = toNumber(prices.cardmarket_price);
    if (cm) {
      quotes.push({
        source: "ygoprodeck",
        sourceLabel: "Cardmarket (via YGOPRODeck)",
        currency: "EUR",
        url: null,
        matchedName: best.name,
        matchedDetail: set ? `${set.set_name} · ${set.set_code}` : null,
        ungraded: round2(cm),
        ungradedVariants: {},
        graded: {},
        fetchedAt,
        externalId: String(best.id),
      });
    }
    return quotes;
  },
};
