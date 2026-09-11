import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { nameKey } from "./name-key";

export function dataDir(): string {
  const dir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function uploadsDir(): string {
  const dir = path.join(dataDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  sport TEXT,
  name TEXT NOT NULL,
  set_name TEXT,
  set_code TEXT,
  card_number TEXT,
  year INTEGER,
  rarity TEXT,
  variant TEXT,
  language TEXT,
  manufacturer TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  condition TEXT NOT NULL DEFAULT 'NM',
  grading_company TEXT,
  grade TEXT,
  cert_number TEXT,
  purchase_price REAL,
  notes TEXT,
  image_path TEXT,
  reference_image_url TEXT,
  external_ids TEXT NOT NULL DEFAULT '{}',
  identification TEXT,
  manual_ungraded REAL,
  manual_graded TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL,
  summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_card ON price_snapshots(card_id, fetched_at DESC);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  fees REAL NOT NULL DEFAULT 0,
  unit_cost REAL,
  sold_at TEXT NOT NULL,
  venue TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_card ON sales(card_id, sold_at DESC);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  service_level TEXT,
  fee_per_card REAL NOT NULL DEFAULT 0,
  shipping REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  sent_at TEXT,
  returned_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submission_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  raw_value REAL,
  expected_value REAL,
  returned_grade TEXT,
  returned_value REAL,
  UNIQUE (submission_id, card_id)
);
CREATE INDEX IF NOT EXISTS idx_submission_cards ON submission_cards(submission_id);
CREATE TABLE IF NOT EXISTS set_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  set_id TEXT NOT NULL,
  set_name TEXT NOT NULL,
  cards TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (game, set_id)
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
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
const MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "cards", column: "grading_status", ddl: "ALTER TABLE cards ADD COLUMN grading_status TEXT NOT NULL DEFAULT 'undecided'" },
  { table: "cards", column: "accent_color", ddl: "ALTER TABLE cards ADD COLUMN accent_color TEXT" },
  { table: "cards", column: "location", ddl: "ALTER TABLE cards ADD COLUMN location TEXT" },
  { table: "cards", column: "name_key", ddl: "ALTER TABLE cards ADD COLUMN name_key TEXT" },
];

/**
 * Indexes that name a column a migration adds, so they come after the columns.
 *
 * `name_key` is the normalised name stored rather than computed: duplicate
 * detection looks a card up by its normalised name on every add, and an
 * expression in the WHERE clause cannot use an index, so that was a full scan
 * of the cards table per row — over a table an import is itself growing.
 */
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_cards_lookup ON cards(game, name_key);
`;

/** Schema and column migrations: DDL only, which fires nothing the file itself defines. */
function applySchema(db: Database.Database): void {
  db.exec(SCHEMA);
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === m.column)) db.exec(m.ddl);
  }
  db.exec(INDEXES);
}

/**
 * Fill in `name_key` for rows written before the column existed, or written by
 * a version that computed it differently.
 *
 * This is the one statement in this module that *writes*, and it is deliberately
 * not part of opening a database. SQLite runs the opened file's own triggers on
 * an UPDATE, so running this against a database someone else wrote — the staged
 * copy of an uploaded archive, say — executes whatever that file's author put in
 * it, before anything has looked at the file at all. It belongs to this app's
 * own database and nothing else; see openStagedDatabase.
 */
function backfillNameKeys(db: Database.Database): void {
  db.function("cc_name_key", { deterministic: true }, (v: unknown) => nameKey(typeof v === "string" ? v : String(v ?? "")));
  db.exec("UPDATE cards SET name_key = cc_name_key(name) WHERE name_key IS NOT cc_name_key(name)");
}

/** Open a database this app owns, bringing its schema up to date. */
export function openDatabase(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}

/** The live database: the schema, plus the row repairs that only ever apply to this app's own file. */
export function openLiveDatabase(file: string): Database.Database {
  const db = openDatabase(file);
  backfillNameKeys(db);
  return db;
}

/**
 * A database that came from outside, opened for inspection and nothing else.
 *
 * Read-only at the connection, and `query_only` on top of it, so neither this
 * app nor anything the file itself defines can write: no schema is applied, no
 * rows are repaired, and only SELECTs run — which fire no triggers. A restore
 * is the one place this app is handed a whole database written by someone else,
 * and every statement it runs against that file before deciding to trust it is
 * a statement the file's author chose the meaning of.
 */
export function openStagedDatabase(file: string): Database.Database {
  const db = new Database(file, { readonly: true });
  db.pragma("query_only = 1");
  return db;
}

/**
 * Everything this app's own schema creates, as sqlite_master reports it, plus
 * each table's columns and which of those a database written by an older
 * version may legitimately lack. Derived by building the schema in memory
 * rather than listed by hand, so it cannot drift from SCHEMA and MIGRATIONS.
 */
export function ownSchema(): { objects: Map<string, string>; columns: Map<string, Set<string>>; addedLater: Set<string> } {
  const probe = new Database(":memory:");
  try {
    applySchema(probe);
    const objects = new Map<string, string>();
    const columns = new Map<string, Set<string>>();
    for (const row of probe.prepare("SELECT name, type FROM sqlite_master").all() as Array<{ name: string; type: string }>) {
      objects.set(row.name, row.type);
      if (row.type !== "table") continue;
      const cols = probe.prepare(`PRAGMA table_info("${row.name}")`).all() as Array<{ name: string }>;
      columns.set(row.name, new Set(cols.map((c) => c.name)));
    }
    return { objects, columns, addedLater: new Set(MIGRATIONS.map((m) => `${m.table}.${m.column}`)) };
  } finally {
    probe.close();
  }
}

// Next.js reloads server modules in development; keep one connection per process.
const globalForDb = globalThis as unknown as { __collectcollectDb?: Database.Database; __collectcollectLocked?: string };

/** The file the live connection uses, which a restore has to replace. */
export function databaseFile(): string {
  return process.env.DATABASE_FILE ?? path.join(dataDir(), "collectcollect.db");
}

export function getDb(): Database.Database {
  if (globalForDb.__collectcollectLocked) {
    // A restore is swapping the file out; opening it now would either cache a
    // connection to a file about to be replaced or create an empty one.
    throw new Error(globalForDb.__collectcollectLocked);
  }
  if (!globalForDb.__collectcollectDb) {
    globalForDb.__collectcollectDb = openLiveDatabase(databaseFile());
  }
  return globalForDb.__collectcollectDb;
}

/**
 * Refuse new connections while the database file is being replaced. Returns
 * false when a swap is already under way, so two restores cannot interleave.
 */
export function lockDatabase(reason: string): boolean {
  if (globalForDb.__collectcollectLocked) return false;
  globalForDb.__collectcollectLocked = reason;
  return true;
}

export function unlockDatabase(): void {
  globalForDb.__collectcollectLocked = undefined;
}

/** Swap the shared connection (used by tests to point at an in-memory database). */
export function setDb(db: Database.Database | undefined): void {
  globalForDb.__collectcollectDb = db;
}
