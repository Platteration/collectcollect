import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { DB_FILE, dataDir, resetDataDirLookup } from "./paths";

// Where the data lives is decided in ./paths, which has no dependency on
// SQLite, so that the request proxy can read the session file beside it
// without loading the database driver.
export { DB_FILE, dataDir, resetDataDirLookup };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_hash_name TEXT NOT NULL,
  category TEXT NOT NULL,
  stackable INTEGER NOT NULL DEFAULT 1,
  weapon TEXT,
  finish TEXT,
  exterior TEXT,
  rarity TEXT,
  collection TEXT,
  stattrak INTEGER NOT NULL DEFAULT 0,
  souvenir INTEGER NOT NULL DEFAULT 0,
  float_value REAL,
  paint_seed INTEGER,
  paint_index INTEGER,
  name_tag TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  purchase_price REAL,
  asset_id TEXT,
  inspect_link TEXT,
  tradable_after TEXT,
  storage_unit TEXT,
  image_url TEXT,
  notes TEXT,
  external_ids TEXT NOT NULL DEFAULT '{}',
  manual_price REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(market_hash_name);
CREATE TABLE IF NOT EXISTS item_stickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  name TEXT NOT NULL,
  market_hash_name TEXT,
  wear REAL,
  UNIQUE (item_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_stickers_item ON item_stickers(item_id, slot);
CREATE TABLE IF NOT EXISTS acquisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  unit_cost REAL,
  acquired_at TEXT NOT NULL,
  source TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acquisitions_item ON acquisitions(item_id, acquired_at, id);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  fees REAL NOT NULL DEFAULT 0,
  unit_cost REAL,
  sold_at TEXT NOT NULL,
  venue TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_item ON sales(item_id, sold_at DESC);
CREATE TABLE IF NOT EXISTS sale_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  acquisition_id INTEGER REFERENCES acquisitions(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  unit_cost REAL
);
CREATE INDEX IF NOT EXISTS idx_sale_lots_sale ON sale_lots(sale_id);
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL,
  summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_item ON price_snapshots(item_id, fetched_at DESC);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(read_at, created_at DESC);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Columns added after the first release; applied when missing so older databases keep working. */
const MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [];

export function openDatabase(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === m.column)) db.exec(m.ddl);
  }
  ensureAssetIndex(db);
  return db;
}

/**
 * An asset id names one object in one Steam account, so importing the same
 * inventory twice must find the row it made last time rather than duplicate
 * it; the index is what enforces that.
 *
 * It is not part of the schema block because a database from before the index
 * can already hold two rows with one asset id, and `CREATE UNIQUE INDEX` on
 * such a table fails — which, run at open, would lock the owner out of their
 * own inventory. So the duplicates are resolved first: the newest row keeps
 * the id and the others lose it (nothing else about them changes), each is
 * named in the log, and then the index goes on. An index that still cannot be
 * built is reported rather than fatal.
 */
function ensureAssetIndex(db: Database.Database): void {
  const present = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_asset'").get();
  if (present) return;
  try {
    db.transaction(() => {
      const duplicated = db
        .prepare(
          `SELECT asset_id AS assetId, GROUP_CONCAT(id) AS ids FROM items
           WHERE asset_id IS NOT NULL GROUP BY asset_id HAVING COUNT(*) > 1`,
        )
        .all() as Array<{ assetId: string; ids: string }>;
      for (const dup of duplicated) {
        const ids = dup.ids.split(",").map(Number);
        const keep = Math.max(...ids);
        const losers = ids.filter((id) => id !== keep);
        db.prepare(`UPDATE items SET asset_id = NULL WHERE id IN (${losers.map(() => "?").join(",")})`).run(...losers);
        console.warn(
          `[collectcollect-skins] Asset id ${dup.assetId} was on items ${ids.join(", ")}; item ${keep} keeps it and the rest now have none.`,
        );
      }
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_items_asset ON items(asset_id) WHERE asset_id IS NOT NULL");
    })();
  } catch (e) {
    console.warn(`[collectcollect-skins] Could not build the asset id index: ${e instanceof Error ? e.message : e}`);
  }
}

// Next.js reloads server modules in development; keep one connection per process.
const globalForDb = globalThis as unknown as { __skinsDb?: Database.Database; __skinsLocked?: string };

/** The file the live connection uses, which a restore has to replace. */
export function databaseFile(): string {
  return process.env.SKINS_DATABASE_FILE ?? path.join(dataDir(), DB_FILE);
}

/**
 * Whether `next build` is running.
 *
 * Nothing should read a collection while building — every page that needs data
 * is rendered on demand — and reading one has two costs that are easy to miss.
 * On a machine with no collection it creates an empty database beside the
 * source; on a machine with one, the file tracer sees the read and packages
 * that collection into the standalone output, and from there into any image
 * built from it.
 */
export function building(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Whether there is an inventory to read without bringing one into existence.
 *
 * An open connection counts, which is what a test that swapped in an in-memory
 * database has; otherwise it is whether the file is there. Opening one is what
 * creates it, so anything that only wants to look has to ask first.
 */
export function databaseExists(): boolean {
  return Boolean(globalForDb.__skinsDb) || fs.existsSync(databaseFile());
}

export function getDb(): Database.Database {
  if (globalForDb.__skinsLocked) {
    // A restore is swapping the file out; opening it now would either cache a
    // connection to a file about to be replaced or create an empty one.
    throw new Error(globalForDb.__skinsLocked);
  }
  if (!globalForDb.__skinsDb) {
    globalForDb.__skinsDb = openDatabase(databaseFile());
  }
  return globalForDb.__skinsDb;
}

/**
 * Refuse new connections while the database file is being replaced. Returns
 * false when a swap is already under way, so two restores cannot interleave.
 */
export function lockDatabase(reason: string): boolean {
  if (globalForDb.__skinsLocked) return false;
  globalForDb.__skinsLocked = reason;
  return true;
}

export function unlockDatabase(): void {
  globalForDb.__skinsLocked = undefined;
}

/**
 * Close the live connection and forget it, so the file can be replaced on
 * every platform. Works while the database is locked, which is the only time
 * it is needed.
 */
export function closeDatabase(): void {
  try {
    globalForDb.__skinsDb?.close();
  } catch {
    /* already closed */
  }
  globalForDb.__skinsDb = undefined;
}

/** Swap the shared connection (used by tests to point at a throwaway file). */
export function setDb(db: Database.Database | undefined): void {
  globalForDb.__skinsDb = db;
}
