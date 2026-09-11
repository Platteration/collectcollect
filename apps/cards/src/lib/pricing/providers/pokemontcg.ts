import type { PriceQuote } from "../../types";
import type { CardQuery, PriceProvider } from "../types";
import { ProviderError } from "../types";
import { numberPart, round2, sameNumber, setSimilarity, toNumber, tokenOverlap } from "../match";
import { lookup } from "@collectcollect/core/lookup";

/**
 * Pokémon TCG API (https://pokemontcg.io). Free; an API key raises rate limits.
 * Exposes TCGplayer (USD) and Cardmarket (EUR) market prices for raw cards.
 */

interface PtcgCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set: { id: string; name: string; series?: string; releaseDate?: string; ptcgoCode?: string };
  images?: { small?: string; large?: string };
  tcgplayer?: {
    url?: string;
    prices?: Record<string, { low?: number; mid?: number; high?: number; market?: number }>;
  };
  cardmarket?: {
    url?: string;
    prices?: { averageSellPrice?: number; trendPrice?: number; avg7?: number; avg30?: number };
  };
}

const VARIANT_LABELS: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holofoil",
  "1stEditionHolofoil": "1st Edition Holofoil",
  "1stEditionNormal": "1st Edition Normal",
  unlimitedHolofoil: "Unlimited Holofoil",
};

/** Pick the TCGplayer price key that best matches the card's printing variant. */
export function pickVariantKey(variant: string | null | undefined, available: string[]): string | null {
  if (available.length === 0) return null;
  const v = (variant ?? "").toLowerCase();
  const prefer: string[] = [];
  if (v.includes("1st")) prefer.push("1stEditionHolofoil", "1stEditionNormal");
  if (v.includes("reverse")) prefer.push("reverseHolofoil");
  if (v.includes("holo") || v.includes("foil")) prefer.push("holofoil", "unlimitedHolofoil");
  prefer.push("normal", "holofoil", "reverseHolofoil", "unlimitedHolofoil", "1stEditionNormal", "1stEditionHolofoil");
  for (const key of prefer) if (available.includes(key)) return key;
  return available[0] ?? null;
}

function escapeQuery(s: string): string {
  return s.replace(/["\\]/g, " ").trim();
}

export function buildQuery(q: CardQuery): string {
  const parts: string[] = [`name:"${escapeQuery(q.name)}"`];
  const num = numberPart(q.cardNumber);
  if (num) parts.push(`number:${escapeQuery(num).replace(/^0+(\d)/, "$1")}`);
  return parts.join(" ");
}

export function scoreCandidate(q: CardQuery, c: PtcgCard): number {
  let score = 0;
  if (c.name.toLowerCase() === q.name.toLowerCase()) score += 3;
  else score += tokenOverlap(q.name, c.name) * 2;
  if (sameNumber(q.cardNumber, c.number)) score += 3;
  if (q.setName) score += Math.max(setSimilarity(q.setName, c.set.name), setSimilarity(q.setName, c.set.series) * 0.8) * 3;
  if (q.setCode && (c.set.ptcgoCode?.toLowerCase() === q.setCode.toLowerCase() || c.set.id.toLowerCase() === q.setCode.toLowerCase())) score += 3;
  if (q.year && c.set.releaseDate?.startsWith(String(q.year))) score += 1;
  return score;
}

export const pokemonTcgProvider: PriceProvider = {
  id: "pokemontcg",
  label: "Pokémon TCG API (TCGplayer / Cardmarket)",
  games: ["pokemon"],
  optional: true,
  note: "Works without a key; set POKEMONTCG_API_KEY for higher rate limits.",
  isConfigured: () => true,
  async lookup(q, fetchImpl = fetch) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;

    let cards: PtcgCard[] = [];
    const knownId = q.externalIds?.pokemontcg;
    if (knownId) {
      const res = await fetchImpl(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(knownId)}`, { headers });
      // A 200 whose body has no `data` would otherwise put undefined in the
      // list and blow up in scoring; fall through to the search instead.
      const one = res.ok ? ((await res.json()) as { data?: PtcgCard }).data : null;
      if (one) cards = [one];
    }
    if (cards.length === 0) {
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(buildQuery(q))}&pageSize=50&orderBy=-set.releaseDate`;
      const res = await fetchImpl(url, { headers });
      if (!res.ok) throw new ProviderError("pokemontcg", `Pokémon TCG API returned HTTP ${res.status}`);
      cards = ((await res.json()) as { data?: PtcgCard[] }).data ?? [];
      if (cards.length === 0 && q.cardNumber) {
        // Retry on name alone in case the number was misread.
        const res2 = await fetchImpl(
          `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(buildQuery({ ...q, cardNumber: null }))}&pageSize=50`,
          { headers },
        );
        if (res2.ok) cards = ((await res2.json()) as { data?: PtcgCard[] }).data ?? [];
      }
    }
    if (cards.length === 0) return [];

    const top = cards.map((c) => ({ c, s: scoreCandidate(q, c) })).sort((a, b) => b.s - a.s)[0];
    if (!top) return [];
    const best = top.c;
    const fetchedAt = new Date().toISOString();
    const quotes: PriceQuote[] = [];
    const detail = `${best.set.name} · #${best.number}${best.rarity ? ` · ${best.rarity}` : ""}`;

    const prices = best.tcgplayer?.prices ?? {};
    const market: Record<string, number> = {};
    for (const [k, p] of Object.entries(prices)) {
      const m = toNumber(p?.market);
      if (m) market[k] = m;
    }
    const keys = Object.keys(market);
    const chosen = pickVariantKey(q.variant, keys);
    const chosenMarket = chosen === null ? undefined : market[chosen];
    const variants: Record<string, number> = {};
    for (const [k, m] of Object.entries(market)) variants[lookup(VARIANT_LABELS, k) ?? k] = round2(m);
    quotes.push({
      source: "pokemontcg",
      sourceLabel: "TCGplayer market (via Pokémon TCG API)",
      currency: "USD",
      url: best.tcgplayer?.url ?? null,
      matchedName: best.name,
      matchedDetail: chosen ? `${detail} · ${lookup(VARIANT_LABELS, chosen) ?? chosen}` : detail,
      ungraded: chosenMarket === undefined ? null : round2(chosenMarket),
      ungradedVariants: variants,
      graded: {},
      fetchedAt,
      externalId: best.id,
      referenceImageUrl: best.images?.large ?? best.images?.small ?? null,
    });

    const cm = best.cardmarket?.prices;
    const cmPrice = toNumber(cm?.trendPrice) ?? toNumber(cm?.averageSellPrice);
    if (cmPrice) {
      quotes.push({
        source: "pokemontcg",
        sourceLabel: "Cardmarket trend (via Pokémon TCG API)",
        currency: "EUR",
        url: best.cardmarket?.url ?? null,
        matchedName: best.name,
        matchedDetail: detail,
        ungraded: round2(cmPrice),
        ungradedVariants: {
          ...(toNumber(cm?.averageSellPrice) ? { "Average sell": round2(cm!.averageSellPrice!) } : {}),
          ...(toNumber(cm?.avg7) ? { "7-day average": round2(cm!.avg7!) } : {}),
          ...(toNumber(cm?.avg30) ? { "30-day average": round2(cm!.avg30!) } : {}),
        },
        graded: {},
        fetchedAt,
        externalId: best.id,
      });
    }
    return quotes;
  },
};
