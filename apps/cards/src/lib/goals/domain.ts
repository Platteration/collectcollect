import { isGame, MAX_MONEY, MAX_QUANTITY, type CardRecord, type Game } from "../types";
import { normalizeNumber } from "../pricing/match";

export interface GoalInput { name: string; budget: number | null; targetDate: string | null; archived: boolean }
export interface GoalItemInput {
  game: Game; name: string; setName: string | null; setCode: string | null; cardNumber: string | null;
  variant: string | null; language: string | null; externalIds: Record<string, string>;
  quantity: number; unitBudget: number | null; priority: "high" | "normal" | "low"; notes: string | null;
}
export interface GoalItem extends GoalItemInput { id: string; goalId: string; owned: number; remaining: number }
export interface Goal extends GoalInput {
  id: string; createdAt: string; updatedAt: string; items: GoalItem[];
  wanted: number; owned: number; remainingBudget: number; unbudgeted: number;
}
export const norm = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("en-US");
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected an object");
  return v as Record<string, unknown>;
};
function text(v: unknown, label: string, max = 500): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.trim().length > max) throw new Error(`${label} must be text of at most ${max} characters`);
  return v.trim() || null;
}
function money(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_MONEY) throw new Error("Budget must be a non-negative amount");
  return Math.round(v * 100) / 100;
}
export function normalizeGoal(value: unknown): GoalInput {
  const v = object(value);
  const name = text(v.name, "Goal name", 120);
  if (!name) throw new Error("Give the goal a name");
  const targetDate = text(v.targetDate, "Target date", 10);
  if (targetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !Number.isFinite(Date.parse(targetDate)) || new Date(targetDate).toISOString().slice(0, 10) !== targetDate)) throw new Error("Target date must be a valid date");
  if (v.archived !== undefined && typeof v.archived !== "boolean") throw new Error("Archived must be true or false");
  return { name, budget: money(v.budget), targetDate, archived: v.archived === true };
}
export function normalizeGoalItem(value: unknown): GoalItemInput {
  const v = object(value);
  if (!isGame(v.game)) throw new Error("Choose a game");
  const name = text(v.name, "Card name");
  if (!name) throw new Error("Give the wanted card a name");
  const quantity = v.quantity ?? 1;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) throw new Error("Target quantity must be a positive whole number");
  const priority = v.priority ?? "normal";
  if (priority !== "high" && priority !== "normal" && priority !== "low") throw new Error("Unknown priority");
  const externalIds: Record<string, string> = {};
  if (v.externalIds !== undefined) {
    for (const [key, raw] of Object.entries(object(v.externalIds))) {
      if (!["scryfall", "pokemontcg", "ygoprodeck", "pricecharting"].includes(key)) continue;
      const id = text(raw, "Provider identifier", 200);
      if (id) externalIds[key] = id;
    }
  }
  return { game: v.game, name, setName: text(v.setName, "Set"), setCode: text(v.setCode, "Set code", 100),
    cardNumber: text(v.cardNumber, "Collector number", 100), variant: text(v.variant, "Printing"), language: text(v.language, "Language", 100),
    externalIds, quantity, unitBudget: money(v.unitBudget), priority, notes: text(v.notes, "Notes", 4000) };
}
export function itemIdentity(item: GoalItemInput): string {
  return JSON.stringify([item.game, norm(item.setName) || norm(item.setCode), normalizeNumber(item.cardNumber) || norm(item.name), norm(item.variant), norm(item.language)]);
}
export function matchesGoalItem(item: GoalItemInput, card: CardRecord): boolean {
  if (item.game !== card.game || card.quantity <= 0) return false;
  if (item.variant && norm(item.variant) !== norm(card.variant)) return false;
  if (item.language && norm(item.language) !== norm(card.language)) return false;
  if (item.setCode && card.setCode) {
    if (norm(item.setCode) !== norm(card.setCode)) return false;
  } else if (item.setCode && !item.setName) {
    return false; // A code-only requirement cannot be verified from a number alone.
  } else if (item.setName && norm(item.setName) !== norm(card.setName)) return false;
  const commonIds = Object.keys(item.externalIds).filter((key) => card.externalIds[key]);
  if (commonIds.length && !commonIds.some((key) => item.externalIds[key] === card.externalIds[key])) return false;
  const wanted = normalizeNumber(item.cardNumber), held = normalizeNumber(card.cardNumber);
  if (wanted && held) return wanted === held && (Boolean(item.setName || item.setCode) || norm(item.name) === norm(card.name));
  return norm(item.name) === norm(card.name);
}
/** A name-only match is allowed only when that name identifies a single wanted printing. */
export function allocateGoalProgress(items: GoalItemInput[], cards: CardRecord[]): Array<{ owned: number; remaining: number }> {
  const sortedCards = [...cards].sort((a, b) => a.id - b.id);
  const available = new Map(cards.map((card) => [card.id, Math.max(0, card.quantity)]));
  const candidateCounts = new Map(cards.map((card) => [card.id, items.filter((candidate) => matchesGoalItem(candidate, card)).length]));
  const result = items.map((item) => ({ owned: 0, remaining: item.quantity }));
  const specificity = (item: GoalItemInput) => Number(Boolean(item.variant)) * 8 + Number(Boolean(item.language)) * 4 + Number(Boolean(item.cardNumber)) * 2 + Number(Boolean(item.setName || item.setCode));
  const order = items.map((item, index) => ({ item, index })).sort((a, b) => specificity(b.item) - specificity(a.item) || itemIdentity(a.item).localeCompare(itemIdentity(b.item)) || a.index - b.index);
  // Each physical copy can fill one target in this goal. Exact printing
  // requirements get first choice; separate goals calculate independently.
  for (const { item, index } of order) {
    for (const card of sortedCards) {
      if (!matchesGoalItem(item, card)) continue;
      if ((!normalizeNumber(item.cardNumber) || !normalizeNumber(card.cardNumber)) && candidateCounts.get(card.id) !== 1) continue;
      const take = Math.min(available.get(card.id) ?? 0, result[index]!.remaining);
      available.set(card.id, (available.get(card.id) ?? 0) - take);
      result[index]!.owned += take; result[index]!.remaining -= take;
      if (result[index]!.remaining === 0) break;
    }
  }
  return result;
}
