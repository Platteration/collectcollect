import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/** The file that marks a directory as holding this app's collection. */
export const DB_FILE = "collectcollect.db";

/**
 * Where the collection lives.
 *
 * `DATA_DIR` wins. Otherwise it is `data` beside the working directory — but
 * this app used to run from the repository root and now runs from its own
 * workspace, so that default moved. Pointing a working install at an empty
 * folder and calling it an empty collection is the worst thing this app could
 * do, so when the default holds no database and an older one is found above it,
 * that one is used and says so out loud.
 */
export function dataDir(): string {
  const dir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : defaultDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let legacyLookup: { done: boolean; dir: string | null } = { done: false, dir: null };

function defaultDataDir(): string {
  const here = path.resolve(process.cwd(), "data");
  if (fs.existsSync(path.join(here, DB_FILE))) return here;
  return findLegacyDataDir() ?? here;
}

/**
 * A `data` directory holding a collection somewhere above the working
 * directory, from before this app moved into a workspace of its own. Looked for
 * once; a missing one is the normal case for a fresh install.
 */
function findLegacyDataDir(): string | null {
  if (legacyLookup.done) return legacyLookup.dir;
  legacyLookup = { done: true, dir: null };
  let at = process.cwd();
  for (let up = 0; up < 4; up++) {
    const parent = path.dirname(at);
    if (parent === at) break;
    at = parent;
    const candidate = path.join(at, "data");
    if (fs.existsSync(path.join(candidate, DB_FILE))) {
      console.warn(
        `[collectcollect] Using the collection found at ${candidate}. Set DATA_DIR to choose a different one.`,
      );
      legacyLookup.dir = candidate;
      return candidate;
    }
  }
  return null;
}

/** Tests only: forget where the older collection was found. */
export function resetDataDirLookup(): void {
  legacyLookup = { done: false, dir: null };
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
CREATE TABLE IF NOT EXISTS acquisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  unit_cost REAL,
  acquired_at TEXT NOT NULL,
  source TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acquisitions_card ON acquisitions(card_id, acquired_at, id);
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
];

export function openDatabase(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === m.column)) db.exec(m.ddl);
  }
  backfillAcquisitions(db);
  return db;
}

const BACKFILL_KEY = "acquisitions_backfilled";

/**
 * Cost used to be one price per card, however many copies were bought and
 * whenever. Every card that predates acquisition lots gets one lot standing for
 * everything ever bought of it.
 *
 * The lot's size counts the copies sold as well as the copies still held, so a
 * card already sold down does not end up claiming it was never owned. The cost
 * may be null: "we do not know what this cost" is a real answer and a better
 * one than a made-up number.
 */
function backfillAcquisitions(db: Database.Database): void {
  const done = db.prepare("SELECT value FROM settings WHERE key = ?").get(BACKFILL_KEY);
  if (done) return;
  const rows = db
    .prepare(
      `SELECT c.id, c.quantity, c.purchase_price, c.created_at,
              COALESCE((SELECT SUM(s.quantity) FROM sales s WHERE s.card_id = c.id), 0) AS sold
       FROM cards c
       WHERE NOT EXISTS (SELECT 1 FROM acquisitions a WHERE a.card_id = c.id)`,
    )
    .all() as Array<{ id: number; quantity: number; purchase_price: number | null; created_at: string; sold: number }>;
  const insert = db.prepare(
    `INSERT INTO acquisitions (card_id, quantity, remaining, unit_cost, acquired_at, source, notes, created_at)
     VALUES (?, ?, ?, ?, ?, 'migrated', NULL, ?)`,
  );
  const mark = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  db.transaction(() => {
    for (const row of rows) {
      insert.run(row.id, row.quantity + row.sold, row.quantity, row.purchase_price, row.created_at, row.created_at);
    }
    mark.run(BACKFILL_KEY, new Date().toISOString());
  })();
}

// Next.js reloads server modules in development; keep one connection per process.
const globalForDb = globalThis as unknown as { __collectcollectDb?: Database.Database; __collectcollectLocked?: string };

/** The file the live connection uses, which a restore has to replace. */
export function databaseFile(): string {
  return process.env.DATABASE_FILE ?? path.join(dataDir(), DB_FILE);
}

/**
 * Whether `next build` is running.
 *
 * Nothing should read a collection while building — every page that needs data
 * is rendered on demand — and reading one leaves an empty database beside the
 * source on any machine that does not have one.
 */
export function building(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Whether there is a collection to read without bringing one into existence.
 *
 * An open connection counts, which is what a test that swapped in an in-memory
 * database has; otherwise it is whether the file is there. Opening one is what
 * creates it, so anything that only wants to look has to ask first.
 */
export function databaseExists(): boolean {
  return Boolean(globalForDb.__collectcollectDb) || fs.existsSync(databaseFile());
}

export function getDb(): Database.Database {
  if (globalForDb.__collectcollectLocked) {
    // A restore is swapping the file out; opening it now would either cache a
    // connection to a file about to be replaced or create an empty one.
    throw new Error(globalForDb.__collectcollectLocked);
  }
  if (!globalForDb.__collectcollectDb) {
    globalForDb.__collectcollectDb = openDatabase(databaseFile());
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
