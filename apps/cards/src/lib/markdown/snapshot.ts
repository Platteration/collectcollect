import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { rowToCard, type CardRow } from "../cards";
import { cardFileName, cardMarkdown, type CardBundle } from "./card";
import { snapshotHistory } from "@collectcollect/core/snapshot-history";
import { goalMarkdown } from "../goals/markdown";
import { normalizeGoal, normalizeGoalItem } from "../goals/domain";

export function writeSnapshotMarkdown(db: Database.Database, target: string): void {
  const dir = path.join(target, "cards");
  fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
  const links: string[] = [];
  for (const row of db.prepare("SELECT * FROM cards ORDER BY id").all() as CardRow[]) {
    const card = rowToCard(row);
    const file = cardFileName(card);
    const history = snapshotHistory(db, "card", card.id) as Pick<CardBundle, "sales" | "acquisitions" | "snapshots" | "saleLots">;
    fs.writeFileSync(/* turbopackIgnore: true */ path.join(dir, file), cardMarkdown({ card, ...history }));
    links.push(`- [${card.name.replaceAll("[", "\\[").replaceAll("]", "\\]")}](cards/${file})`);
  }
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collecting_goals'").get()) {
    const goals = db.prepare("SELECT id,data,created_at,updated_at FROM collecting_goals ORDER BY created_at,id").all() as Array<{ id: string; data: string; created_at: string; updated_at: string }>;
    if (goals.length) { fs.mkdirSync(/* turbopackIgnore: true */ path.join(target, "goals"), { recursive: true }); links.push("", "## Collecting goals", ""); }
    for (const goal of goals) {
      if (!/^[a-f0-9-]{36}$/i.test(goal.id)) throw new Error("A collecting goal has an invalid identifier");
      const items = db.prepare("SELECT id,data FROM goal_items WHERE goal_id=? ORDER BY rowid").all(goal.id) as Array<{ id: string; data: string }>;
      const document = { version: 1 as const, id: goal.id, goal: normalizeGoal(JSON.parse(goal.data)), createdAt: goal.created_at, updatedAt: goal.updated_at,
        items: items.map((item) => ({ id: item.id, item: normalizeGoalItem(JSON.parse(item.data)) })) };
      const file = `goal-${goal.id}.md`;
      fs.writeFileSync(/* turbopackIgnore: true */ path.join(target, "goals", file), goalMarkdown(document));
      links.push(`- [${document.goal.name.replaceAll("[", "\\[").replaceAll("]", "\\]")}](goals/${file})`);
    }
  }
  fs.writeFileSync(/* turbopackIgnore: true */ path.join(target, "index.md"), `# Collection snapshot\n\n${links.join("\n")}\n`);
  fs.writeFileSync(/* turbopackIgnore: true */ path.join(target, "README.md"), "# Portable collection\n\nThese files were rendered from the database in this backup. Photos are in ../uploads/. The database preserves all application settings and history.\n");
}
