import { listCards, parseJson } from "../cards";
import { getDb } from "../db";
import { normalizeNumber } from "../pricing/match";
import type { CardRecord, Game } from "../types";
import { setProviderFor } from "./providers";
import { hintFromCards, type Checklist } from "./types";

interface ChecklistRow {
  game: string;
  set_id: string;
  set_name: string;
  cards: string;
  fetched_at: string;
}

/** A set the owner has at least one card from, and how complete it is. */
export interface SetProgress {
  game: Game;
  /** The set name as the owner's cards spell it, which is how they are grouped. */
  key: string;
  setName: string;
  owned: number;
  copies: number;
  /** Cards in the published checklist, once one has been fetched. */
  total: number | null;
  missing: number | null;
  fetchedAt: string | null;
  /** Whether a checklist can be fetched for this game at all. */
  supported: boolean;
}

const groupKey = (game: Game, setName: string) => `${game}:${setName.trim().toLowerCase()}`;

/**
 * A stored checklist, or null when its card list is not readable. The rows are
 * not necessarily ones this app wrote — a restore installs someone else's
 * database whole — and a bare `JSON.parse` here throws out of a server
 * component with nothing to catch it.
 */
function rowToChecklist(row: ChecklistRow): (Checklist & { fetchedAt: string }) | null {
  const cards = parseJson<Checklist["cards"] | null>(row.cards, null);
  if (!Array.isArray(cards)) return null;
  return { game: row.game as Game, setId: row.set_id, setName: row.set_name, cards, fetchedAt: row.fetched_at };
}

export function saveChecklist(list: Checklist): void {
  getDb()
    .prepare(
      `INSERT INTO set_checklists (game, set_id, set_name, cards, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (game, set_id) DO UPDATE SET set_name = excluded.set_name, cards = excluded.cards, fetched_at = excluded.fetched_at`,
    )
    .run(list.game, list.setId, list.setName, JSON.stringify(list.cards), new Date().toISOString());
}

export function getChecklist(game: Game, setId: string): (Checklist & { fetchedAt: string }) | null {
  const row = getDb().prepare("SELECT * FROM set_checklists WHERE game = ? AND set_id = ?").get(game, setId) as ChecklistRow | undefined;
  if (!row) return null;
  return rowToChecklist(row);
}

/** Any stored checklist whose name matches how the owner spells the set. */
function checklistForName(game: Game, setName: string): (Checklist & { fetchedAt: string }) | null {
  const row = getDb()
    .prepare("SELECT * FROM set_checklists WHERE game = ? AND lower(trim(set_name)) = ?")
    .get(game, setName.trim().toLowerCase()) as ChecklistRow | undefined;
  return row ? rowToChecklist(row) : null;
}

/** Which cards of a checklist the owner has, matched on collector number then name. */
export function ownedFromChecklist(checklist: Checklist, owned: CardRecord[]): Set<string> {
  const byNumber = new Map<string, CardRecord>();
  const byName = new Map<string, CardRecord>();
  for (const card of owned) {
    const n = normalizeNumber(card.cardNumber);
    if (n) byNumber.set(n, card);
    byName.set(card.name.trim().toLowerCase(), card);
  }
  const have = new Set<string>();
  for (const entry of checklist.cards) {
    const n = normalizeNumber(entry.number);
    if ((n && byNumber.has(n)) || byName.has(entry.name.trim().toLowerCase())) have.add(entry.number);
  }
  return have;
}

/** Every set the collection touches, with completion where a checklist is known. */
export function setProgress(): SetProgress[] {
  const groups = new Map<string, { game: Game; setName: string; cards: CardRecord[] }>();
  for (const card of listCards()) {
    if (!card.setName?.trim() || card.quantity <= 0) continue;
    const key = groupKey(card.game, card.setName);
    const group = groups.get(key) ?? { game: card.game, setName: card.setName.trim(), cards: [] };
    group.cards.push(card);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const checklist = checklistForName(group.game, group.setName);
      const have = checklist ? ownedFromChecklist(checklist, group.cards) : null;
      return {
        game: group.game,
        key,
        setName: group.setName,
        owned: group.cards.length,
        copies: group.cards.reduce((n, c) => n + c.quantity, 0),
        total: checklist ? checklist.cards.length : null,
        missing: checklist && have ? checklist.cards.length - have.size : null,
        fetchedAt: checklist?.fetchedAt ?? null,
        supported: setProviderFor(group.game) !== null,
      };
    })
    .sort((a, b) => a.setName.localeCompare(b.setName));
}

/** Fetch and store the checklist for one of the owner's sets. */
export async function refreshChecklist(game: Game, setName: string, fetchImpl: typeof fetch = fetch): Promise<Checklist | null> {
  const provider = setProviderFor(game);
  if (!provider) return null;
  const cards = listCards({ game }).filter((c) => (c.setName ?? "").trim().toLowerCase() === setName.trim().toLowerCase());
  const hint = hintFromCards(cards);
  if (!hint) return null;
  const checklist = await provider.checklist({ ...hint, setName }, fetchImpl);
  if (checklist) saveChecklist(checklist);
  return checklist;
}

/** The owner's cards from one set, alongside its checklist. */
export function setDetail(game: Game, setName: string) {
  const owned = listCards({ game }).filter((c) => (c.setName ?? "").trim().toLowerCase() === setName.trim().toLowerCase() && c.quantity > 0);
  const checklist = checklistForName(game, setName);
  const have = checklist ? ownedFromChecklist(checklist, owned) : new Set<string>();
  return { owned, checklist, have };
}
