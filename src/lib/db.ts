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
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDatabase(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
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
