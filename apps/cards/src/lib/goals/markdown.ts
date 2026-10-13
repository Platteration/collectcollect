import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { dataDir } from "../paths";
import { writeFileAtomic } from "@collectcollect/core/atomic-write";
import { itemIdentity, normalizeGoal, normalizeGoalItem, type GoalInput, type GoalItemInput } from "./domain";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const dir = () => path.join(dataDir(), "collection", "goals");
const fileName = (id: string) => `goal-${id}.md`;
let lastError: string | null = null;
export const goalMirrorError = () => lastError;
interface Document { version: 1; id: string; goal: GoalInput; createdAt: string; updatedAt: string; items: Array<{ id: string; item: GoalItemInput }> }
const cell = (value: unknown) => String(value ?? "—").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
export function goalMarkdown(doc: Document): string {
  const lines = [`# ${cell(doc.goal.name)}`, "", `Budget: ${doc.goal.budget === null ? "not set" : `$${doc.goal.budget.toFixed(2)} USD`} · Target: ${doc.goal.targetDate ?? "not set"} · ${doc.goal.archived ? "Archived" : "Active"}`, "", "| Card | Set | Number | Wanted | Price ceiling (USD) |", "| --- | --- | --- | ---: | ---: |"];
  for (const { item } of doc.items) lines.push(`| ${cell(item.name)} | ${cell(item.setName)} | ${cell(item.cardNumber)} | ${item.quantity} | ${cell(item.unitBudget)} |`);
  return `${lines.join("\n")}\n\nThe record below restores this goal, including printing requirements and notes. Progress is calculated from the cards you currently own.\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\`\n`;
}
/** Never overwrite orphan goal files: they may be the only surviving copy. */
export function mirrorGoals(): void {
  if ((process.env.MARKDOWN_MIRROR ?? "on").toLowerCase() === "off" || getDb().inTransaction) return;
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM collecting_goals").all() as Array<{ id: string; data: string; created_at: string; updated_at: string }>;
    if (!rows.length) return;
    fs.mkdirSync(dir(), { recursive: true });
    const items = db.prepare("SELECT id, data FROM goal_items WHERE goal_id = ? ORDER BY rowid");
    for (const row of rows) {
      const doc: Document = { version: 1, id: row.id, goal: normalizeGoal(JSON.parse(row.data)), createdAt: row.created_at, updatedAt: row.updated_at,
        items: (items.all(row.id) as Array<{ id: string; data: string }>).map((item) => ({ id: item.id, item: normalizeGoalItem(JSON.parse(item.data)) })) };
      writeFileAtomic(path.join(dir(), fileName(row.id)), goalMarkdown(doc));
    }
    lastError = null;
  } catch (e) { lastError = e instanceof Error ? e.message : "Could not write goals"; }
}
export function removeGoalFile(id: string): void {
  if (!uuid.test(id) || (process.env.MARKDOWN_MIRROR ?? "on").toLowerCase() === "off") return;
  try { fs.rmSync(path.join(dir(), fileName(id)), { force: true }); } catch (e) { lastError = (e as Error).message; }
}
export function goalFiles(): Array<{ name: string; path: string; size: number }> {
  if (!fs.existsSync(dir())) return [];
  return fs.readdirSync(dir()).filter(isGoalFileName).sort().map((name) => ({ name: `goals/${name}`, path: path.join(dir(), name), size: fs.statSync(path.join(dir(), name)).size }));
}
export function isGoalFileName(name: string): boolean { return /^goal-[a-f0-9-]{36}\.md$/i.test(name.split("/").pop() ?? ""); }
/**
 * The JSON record in a goal file: the body of its first ```json fence. What
 * `/(?:^|\n)```json\r?\n([\s\S]*?)\r?\n```(?:\r?\n|$)/` read, found by
 * scanning, because that pattern ran to the end of the text again from every
 * fence opened and never closed: 144 KB of openings took over a second, and a
 * folder read back in may be 64 MB.
 */
export function goalRecord(text: string): string | undefined {
  // The first opening: "```json" alone on a line, CRLF or LF.
  let body = -1;
  for (let at = text.indexOf("```json"); at !== -1; at = text.indexOf("```json", at + 1)) {
    if (at > 0 && text[at - 1] !== "\n") continue;
    const end = at + "```json".length;
    if (text[end] === "\n") body = end + 1;
    else if (text[end] === "\r" && text[end + 1] === "\n") body = end + 2;
    else continue;
    break;
  }
  if (body === -1) return undefined;
  // The first closing after it: "```" alone on a line, or ending the text. A
  // later opening can only find a closing this one would have found first.
  for (let line = text.indexOf("\n```", body); line !== -1; line = text.indexOf("\n```", line + 1)) {
    const after = line + 4;
    if (after !== text.length && text[after] !== "\n" && !(text[after] === "\r" && text[after + 1] === "\n")) continue;
    return text.slice(body, line > body && text[line - 1] === "\r" ? line - 1 : line);
  }
  return undefined;
}

export function importGoalMarkdown(text: string): void {
  const encoded = goalRecord(text);
  if (!encoded) throw new Error("No goal record in this file");
  const raw = JSON.parse(encoded) as Document;
  if (!raw || raw.version !== 1 || typeof raw.id !== "string" || !uuid.test(raw.id) || !Array.isArray(raw.items) || raw.items.length > 20_000) throw new Error("Invalid goal record");
  const goal = normalizeGoal(raw.goal);
  const ids = new Set<string>(), identities = new Set<string>();
  const items = raw.items.map((entry) => {
    if (!entry || typeof entry.id !== "string" || !uuid.test(entry.id) || ids.has(entry.id)) throw new Error("Invalid or repeated wanted-card identifier");
    const item = normalizeGoalItem(entry.item), identity = itemIdentity(item);
    if (identities.has(identity)) throw new Error("Repeated printing in this goal");
    ids.add(entry.id); identities.add(identity);
    return { id: entry.id, item, identity };
  });
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : new Date().toISOString();
  const db = getDb();
  db.transaction(() => {
    db.prepare("INSERT INTO collecting_goals (id, data, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .run(raw.id, JSON.stringify(goal), date(raw.createdAt), date(raw.updatedAt));
    db.prepare("DELETE FROM goal_items WHERE goal_id = ?").run(raw.id);
    const insert = db.prepare("INSERT INTO goal_items (id, goal_id, identity, data) VALUES (?, ?, ?, ?)");
    for (const entry of items) insert.run(entry.id, raw.id, entry.identity, JSON.stringify(entry.item));
  })();
}
