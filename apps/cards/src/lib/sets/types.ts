import type { CardRecord, Game } from "../types";

/** One card as the set's own checklist lists it. */
export interface ChecklistCard {
  /** Collector number exactly as the source gives it. */
  number: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
}

export interface Checklist {
  game: Game;
  /** Stable identifier for the set at its source, e.g. "base1" or "mh2". */
  setId: string;
  setName: string;
  cards: ChecklistCard[];
}

/** What a provider needs to work out which set the owner's cards belong to. */
export interface SetHint {
  game: Game;
  setName: string | null;
  setCode: string | null;
  /** Provider ids learned from pricing, e.g. { pokemontcg: "base1-4" }. */
  externalIds: Record<string, string>;
}

export interface SetProvider {
  game: Game;
  label: string;
  /** Fetch every card in the set the hint points at, or null when it cannot tell which set that is. */
  checklist(hint: SetHint, fetchImpl?: typeof fetch): Promise<Checklist | null>;
}

export function hintFromCards(cards: CardRecord[]): SetHint | null {
  const first = cards[0];
  if (!first) return null;
  const externalIds: Record<string, string> = {};
  for (const card of cards) for (const [k, v] of Object.entries(card.externalIds)) if (!externalIds[k]) externalIds[k] = v;
  return {
    game: first.game,
    setName: cards.find((c) => c.setName)?.setName ?? null,
    setCode: cards.find((c) => c.setCode)?.setCode ?? null,
    externalIds,
  };
}
