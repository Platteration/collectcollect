import type { Checklist, ChecklistCard, SetProvider } from "./types";

const PAGE_LIMIT = 10; // enough for any real set, and a stop for a misbehaving API

/**
 * Pokémon checklists come from the same API as its prices. The set id is taken
 * from a card id learned while pricing ("base1-4" belongs to set "base1"),
 * falling back to a search by name.
 */
export const pokemonSets: SetProvider = {
  game: "pokemon",
  label: "Pokémon TCG API",
  async checklist(hint, fetchImpl = fetch) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;

    let setId = hint.externalIds.pokemontcg?.split("-")[0] ?? null;
    let setName = hint.setName ?? "";
    if (!setId && hint.setName) {
      const res = await fetchImpl(`https://api.pokemontcg.io/v2/sets?q=name:"${hint.setName.replace(/"/g, "")}"`, { headers });
      if (!res.ok) throw new Error(`Pokémon TCG API returned HTTP ${res.status}`);
      const sets = ((await res.json()) as { data?: Array<{ id: string; name: string }> }).data ?? [];
      // An exact name beats a partial one: "Base" must not match "Base Set 2".
      const exact = sets.find((s) => s.name.toLowerCase() === hint.setName!.toLowerCase());
      const chosen = exact ?? (sets.length === 1 ? sets[0] : null);
      if (!chosen) return null;
      setId = chosen.id;
      setName = chosen.name;
    }
    if (!setId) return null;

    const cards: ChecklistCard[] = [];
    for (let page = 1; page <= PAGE_LIMIT; page++) {
      const url = `https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(setId)}&pageSize=250&page=${page}&orderBy=number`;
      const res = await fetchImpl(url, { headers });
      if (!res.ok) throw new Error(`Pokémon TCG API returned HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ name: string; number: string; rarity?: string; set?: { name?: string }; images?: { small?: string } }> };
      const data = body.data ?? [];
      if (data.length === 0) break;
      for (const c of data) {
        if (!setName && c.set?.name) setName = c.set.name;
        cards.push({ number: c.number, name: c.name, rarity: c.rarity ?? null, imageUrl: c.images?.small ?? null });
      }
      if (data.length < 250) break;
    }
    return cards.length ? { game: "pokemon", setId, setName: setName || setId, cards } : null;
  },
};

/** Magic checklists come from Scryfall, keyed by the three-or-four letter set code. */
export const magicSets: SetProvider = {
  game: "mtg",
  label: "Scryfall",
  async checklist(hint, fetchImpl = fetch) {
    const code = hint.setCode?.trim().toLowerCase();
    if (!code) return null;
    const headers = { Accept: "application/json", "User-Agent": "collectcollect/0.1 (personal card catalog)" };

    const info = await fetchImpl(`https://api.scryfall.com/sets/${encodeURIComponent(code)}`, { headers });
    if (info.status === 404) return null;
    if (!info.ok) throw new Error(`Scryfall returned HTTP ${info.status}`);
    const set = (await info.json()) as { code: string; name: string };

    const cards: ChecklistCard[] = [];
    let url: string | null = `https://api.scryfall.com/cards/search?q=set%3A${encodeURIComponent(code)}&unique=prints&order=set`;
    for (let page = 0; page < PAGE_LIMIT && url; page++) {
      const res: Response = await fetchImpl(url, { headers });
      if (res.status === 404) break; // a set with no cards yet
      if (!res.ok) throw new Error(`Scryfall returned HTTP ${res.status}`);
      const body = (await res.json()) as {
        data?: Array<{ name: string; collector_number: string; rarity?: string; image_uris?: { small?: string } }>;
        has_more?: boolean;
        next_page?: string;
      };
      for (const c of body.data ?? []) {
        cards.push({ number: c.collector_number, name: c.name, rarity: c.rarity ?? null, imageUrl: c.image_uris?.small ?? null });
      }
      url = body.has_more && body.next_page ? body.next_page : null;
    }
    return cards.length ? { game: "mtg", setId: set.code, setName: set.name, cards } : null;
  },
};

/** Yu-Gi-Oh! checklists come from YGOPRODeck, which lists a set by its full name. */
export const yugiohSets: SetProvider = {
  game: "yugioh",
  label: "YGOPRODeck",
  async checklist(hint, fetchImpl = fetch) {
    const name = hint.setName?.trim();
    if (!name) return null;
    const res = await fetchImpl(`https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(name)}`);
    if (res.status === 400) return null; // how this API says "no such set"
    if (!res.ok) throw new Error(`YGOPRODeck returned HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{ name: string; card_sets?: Array<{ set_name: string; set_code: string; set_rarity?: string }>; card_images?: Array<{ image_url_small?: string }> }>;
    };
    const cards: ChecklistCard[] = [];
    for (const card of body.data ?? []) {
      // A card is printed in many sets; keep the printing from this one.
      const printing = (card.card_sets ?? []).find((s) => s.set_name.toLowerCase() === name.toLowerCase());
      cards.push({
        number: printing?.set_code ?? "",
        name: card.name,
        rarity: printing?.set_rarity ?? null,
        imageUrl: card.card_images?.[0]?.image_url_small ?? null,
      });
    }
    cards.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    return cards.length ? { game: "yugioh", setId: name, setName: name, cards } : null;
  },
};

export const SET_PROVIDERS: SetProvider[] = [pokemonSets, magicSets, yugiohSets];

export function setProviderFor(game: string): SetProvider | null {
  return SET_PROVIDERS.find((p) => p.game === game) ?? null;
}

export type { Checklist };
