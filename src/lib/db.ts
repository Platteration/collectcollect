import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

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
  return db;
}

// Next.js reloads server modules in development; keep one connection per process.
const globalForDb = globalThis as unknown as { __collectcollectDb?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb.__collectcollectDb) {
    const file =
      process.env.DATABASE_FILE ?? path.join(dataDir(), "collectcollect.db");
    globalForDb.__collectcollectDb = openDatabase(file);
  }
  return globalForDb.__collectcollectDb;
}

/** Swap the shared connection (used by tests to point at an in-memory database). */
export function setDb(db: Database.Database | undefined): void {
  globalForDb.__collectcollectDb = db;
}
