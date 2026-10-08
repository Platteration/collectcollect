import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { listCards } from "../cards";
import { getChecklist } from "../sets";
import type { Game } from "../types";
import { allocateGoalProgress, itemIdentity, normalizeGoal, normalizeGoalItem, type Goal, type GoalItem } from "./domain";
import { mirrorGoals, removeGoalFile } from "./markdown";
export type { Goal, GoalInput, GoalItem, GoalItemInput } from "./domain";

interface GoalRow { id: string; data: string; created_at: string; updated_at: string }
interface ItemRow { id: string; goal_id: string; data: string }
export function listGoals(): Goal[] {
  const db = getDb();
  const cards = listCards();
  const itemRows = db.prepare("SELECT id, goal_id, data FROM goal_items ORDER BY rowid").all() as ItemRow[];
  return (db.prepare("SELECT * FROM collecting_goals ORDER BY created_at DESC, id").all() as GoalRow[]).map((row) => {
    const targets = itemRows.filter((item) => item.goal_id === row.id).map((item) => ({ ...normalizeGoalItem(JSON.parse(item.data)), id: item.id, goalId: row.id }));
    const progress = allocateGoalProgress(targets, cards);
    const items = targets.map((item, index) => ({ ...item, ...progress[index]! }));
    return { ...normalizeGoal(JSON.parse(row.data)), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, items,
      wanted: items.reduce((n, item) => n + item.quantity, 0), owned: items.reduce((n, item) => n + item.owned, 0),
      remainingBudget: Math.round(items.reduce((n, item) => n + item.remaining * (item.unitBudget ?? 0), 0) * 100) / 100,
      unbudgeted: items.filter((item) => item.remaining > 0 && item.unitBudget === null).length };
  });
}
export const getGoal = (id: string) => listGoals().find((goal) => goal.id === id) ?? null;
export const getGoalItem = (id: string) => listGoals().flatMap((goal) => goal.items).find((item) => item.id === id) ?? null;
export function saveGoal(input: unknown, id?: string): Goal {
  const data = normalizeGoal(input), db = getDb(), now = new Date().toISOString();
  if (id && !db.prepare("SELECT 1 FROM collecting_goals WHERE id = ?").get(id)) throw new Error("Goal not found");
  const goalId = id ?? randomUUID();
  db.prepare("INSERT INTO collecting_goals (id, data, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .run(goalId, JSON.stringify(data), now, now);
  mirrorGoals();
  return getGoal(goalId)!;
}
export function saveGoalItem(goalId: string, input: unknown, itemId?: string): GoalItem {
  const item = normalizeGoalItem(input), db = getDb();
  if (!db.prepare("SELECT 1 FROM collecting_goals WHERE id = ?").get(goalId)) throw new Error("Goal not found");
  if (itemId && !db.prepare("SELECT 1 FROM goal_items WHERE id = ? AND goal_id = ?").get(itemId, goalId)) throw new Error("Wanted card not found");
  const duplicate = db.prepare("SELECT id, data FROM goal_items WHERE goal_id = ? AND identity = ?").get(goalId, itemIdentity(item)) as { id: string; data: string } | undefined;
  if (duplicate && itemId && duplicate.id !== itemId) throw new Error("This goal already contains that printing");
  const id = itemId ?? duplicate?.id ?? randomUUID();
  if (duplicate && !itemId) item.quantity = Math.max(item.quantity, normalizeGoalItem(JSON.parse(duplicate.data)).quantity);
  db.prepare("INSERT INTO goal_items (id, goal_id, identity, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET identity = excluded.identity, data = excluded.data")
    .run(id, goalId, itemIdentity(item), JSON.stringify(item));
  db.prepare("UPDATE collecting_goals SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), goalId);
  mirrorGoals();
  return getGoalItem(id)!;
}
export function deleteGoalItem(goalId: string, itemId: string): boolean {
  const removed = getDb().prepare("DELETE FROM goal_items WHERE id = ? AND goal_id = ?").run(itemId, goalId).changes > 0;
  mirrorGoals();
  return removed;
}
export function deleteGoal(id: string): boolean {
  const removed = getDb().prepare("DELETE FROM collecting_goals WHERE id = ?").run(id).changes > 0;
  if (removed) removeGoalFile(id);
  mirrorGoals();
  return removed;
}
export function goalFromChecklist(game: Game, setId: string, budget: number | null = null): Goal {
  const checklist = getChecklist(game, setId);
  if (!checklist) throw new Error("Fetch the set checklist first");
  let goalId = "";
  getDb().transaction(() => {
    const goal = saveGoal({ name: `Complete ${checklist.setName}`, budget });
    goalId = goal.id;
    const insert = getDb().prepare("INSERT OR IGNORE INTO goal_items (id, goal_id, identity, data) VALUES (?, ?, ?, ?)");
    for (const entry of checklist.cards) {
      const item = normalizeGoalItem({ game, name: entry.name, setName: checklist.setName, setCode: game === "mtg" ? setId : null, cardNumber: entry.number });
      insert.run(randomUUID(), goal.id, itemIdentity(item), JSON.stringify(item));
    }
  })();
  mirrorGoals();
  return getGoal(goalId)!;
}
