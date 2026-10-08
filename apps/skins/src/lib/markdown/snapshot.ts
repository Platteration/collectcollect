import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { rowToItem, type ItemRow } from "../items";
import type { AppliedSticker } from "../types";
import { itemFileName, itemMarkdown, type ItemBundle } from "./item";
import { snapshotHistory } from "@collectcollect/core/snapshot-history";

export function writeSnapshotMarkdown(db: Database.Database, target: string): void {
  const dir = path.join(target, "items");
  fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
  const links: string[] = [];
  for (const row of db.prepare("SELECT * FROM items ORDER BY id").all() as ItemRow[]) {
    const stickers = db.prepare("SELECT slot, name, market_hash_name AS marketHashName, wear FROM item_stickers WHERE item_id = ? ORDER BY slot").all(row.id) as AppliedSticker[];
    const item = rowToItem(row, stickers);
    const file = itemFileName(item);
    const history = snapshotHistory(db, "item", item.id) as Pick<ItemBundle, "sales" | "acquisitions" | "snapshots" | "saleLots">;
    fs.writeFileSync(/* turbopackIgnore: true */ path.join(dir, file), itemMarkdown({ item, ...history }));
    links.push(`- [${item.marketHashName.replaceAll("[", "\\[").replaceAll("]", "\\]")}](items/${file})`);
  }
  fs.writeFileSync(/* turbopackIgnore: true */ path.join(target, "index.md"), `# Inventory snapshot\n\n${links.join("\n")}\n`);
  fs.writeFileSync(/* turbopackIgnore: true */ path.join(target, "README.md"), "# Portable inventory\n\nThese files were rendered from the database in this backup. The database preserves all application settings and history.\n");
}
