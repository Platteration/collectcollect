import type { PriceQuote } from "../../types";
import type { PriceProvider } from "../types";
import { ProviderError } from "../types";
import { numberPart, round2, toNumber } from "../match";

/** Scryfall (https://scryfall.com/docs/api). Free, no key. Daily USD/EUR prices for Magic cards. */

interface ScryCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity?: string;
  scryfall_uri?: string;
  image_uris?: { normal?: string; large?: string };
  card_faces?: Array<{ image_uris?: { normal?: string } }>;
  prices?: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null; eur?: string | null; eur_foil?: string | null };
}

const HEADERS = { Accept: "application/json", "User-Agent": "collectcollect/0.1 (personal card catalog)" };

export const scryfallProvider: PriceProvider = {
  id: "scryfall",
  label: "Scryfall",
  games: ["mtg"],
  optional: true,
  note: "Free, no key required.",
  isConfigured: () => true,
  async lookup(q, fetchImpl = fetch) {
    let card: ScryCard | null = null;
    const num = numberPart(q.cardNumber);
    if (q.setCode && num) {
      const res = await fetchImpl(`https://api.scryfall.com/cards/${encodeURIComponent(q.setCode.toLowerCase())}/${encodeURIComponent(num)}`, { headers: HEADERS });
      if (res.ok) card = (await res.json()) as ScryCard;
    }
    if (!card) {
      const params = new URLSearchParams({ fuzzy: q.name });
      if (q.setCode) params.set("set", q.setCode.toLowerCase());
      let res = await fetchImpl(`https://api.scryfall.com/cards/named?${params}`, { headers: HEADERS });
      if (res.status === 404 && q.setCode) {
        res = await fetchImpl(`https://api.scryfall.com/cards/named?${new URLSearchParams({ fuzzy: q.name })}`, { headers: HEADERS });
      }
      if (res.status === 404) return [];
      if (!res.ok) throw new ProviderError("scryfall", `Scryfall returned HTTP ${res.status}`);
      card = (await res.json()) as ScryCard;
    }

    const foil = /foil|etched/i.test(q.variant ?? "");
    const usd = toNumber(card.prices?.usd);
    const usdFoil = toNumber(card.prices?.usd_foil) ?? toNumber(card.prices?.usd_etched);
    const variants: Record<string, number> = {};
    if (usd) variants["Non-foil"] = round2(usd);
    if (usdFoil) variants["Foil"] = round2(usdFoil);
    const chosen = foil ? (usdFoil ?? usd) : (usd ?? usdFoil);
    const fetchedAt = new Date().toISOString();
    const detail = `${card.set_name} (${card.set.toUpperCase()}) · #${card.collector_number}${card.rarity ? ` · ${card.rarity}` : ""}`;
    const quotes: PriceQuote[] = [
      {
        source: "scryfall",
        sourceLabel: "Scryfall (TCGplayer-derived USD)",
        currency: "USD",
        url: card.scryfall_uri ?? null,
        matchedName: card.name,
        matchedDetail: `${detail}${chosen ? ` · ${foil && usdFoil ? "Foil" : "Non-foil"}` : ""}`,
        ungraded: chosen ? round2(chosen) : null,
        ungradedVariants: variants,
        graded: {},
        fetchedAt,
        externalId: card.id,
        referenceImageUrl: card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null,
      },
    ];
    const eur = foil ? (toNumber(card.prices?.eur_foil) ?? toNumber(card.prices?.eur)) : toNumber(card.prices?.eur);
    if (eur) {
      quotes.push({
        source: "scryfall",
        sourceLabel: "Scryfall (Cardmarket-derived EUR)",
        currency: "EUR",
        url: card.scryfall_uri ?? null,
        matchedName: card.name,
        matchedDetail: detail,
        ungraded: round2(eur),
        ungradedVariants: {},
        graded: {},
        fetchedAt,
        externalId: card.id,
      });
    }
    return quotes;
  },
};
