import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { columnOf, type DomainSpec, type FieldSpec } from "./spec";

/**
 * Where a domain's collection lives, and the one connection to it.
 *
 * Each app reads its own `<PREFIX>_DATA_DIR`, keeps its own database file,
 * and holds its own connection under its own global key, so several of these
 * apps run side by side from one shell or one .env without ever seeing each
 * other's collection.
 */

export interface DomainDb {
  dataDir(): string;
  uploadsDir(): string;
  databaseFile(): string;
  dbFileName: string;
  openDatabase(file: string): Database.Database;
  getDb(): Database.Database;
  setDb(db: Database.Database | undefined): void;
  lockDatabase(reason: string): boolean;
  unlockDatabase(): void;
  databaseExists(): boolean;
  building(): boolean;
  /** The live connection without going through the restore lock. */
  unlocked(): Database.Database | undefined;
}

export function sqlType(field: FieldSpec): "TEXT" | "REAL" | "INTEGER" {
  switch (field.type) {
    case "number":
      return "REAL";
    case "integer":
    case "boolean":
      return "INTEGER";
    default:
      return "TEXT";
  }
}

const BASE_COLUMNS = [
  "quantity INTEGER NOT NULL DEFAULT 1",
  "purchase_price REAL",
  "notes TEXT",
  "location TEXT",
  "photos TEXT NOT NULL DEFAULT '[]'",
  "reference_image_url TEXT",
  "accent_color TEXT",
  "external_ids TEXT NOT NULL DEFAULT '{}'",
  "identification TEXT",
  "manual_value REAL",
  "manual_prices TEXT NOT NULL DEFAULT '{}'",
  "created_at TEXT NOT NULL",
  "updated_at TEXT NOT NULL",
];

const RESERVED = new Set([
  "id",
  ...BASE_COLUMNS.map((c) => c.split(" ")[0]),
]);

export function schemaFor(spec: Pick<DomainSpec, "fields">): string {
  for (const field of spec.fields) {
    if (RESERVED.has(columnOf(field.key))) throw new Error(`Field "${field.key}" collides with a base column`);
  }
  const domainColumns = spec.fields.map((f) => `${columnOf(f.key)} ${sqlType(f)}`);
  return `
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ${[...BASE_COLUMNS, ...domainColumns].join(",\n  ")}
);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at DESC, id DESC);
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
}

export function createDomainDb(spec: Pick<DomainSpec, "id" | "envPrefix" | "fields">): DomainDb {
  const dbFileName = `collectcollect-${spec.id}.db`;
  const dataDirEnv = `${spec.envPrefix}_DATA_DIR`;
  const dbFileEnv = `${spec.envPrefix}_DATABASE_FILE`;
  const globalKey = `__collectcollect_${spec.id.replace(/[^a-z0-9]/gi, "_")}`;
  const store = globalThis as unknown as Record<string, { db?: Database.Database; locked?: string } | undefined>;
  const state = () => (store[globalKey] ??= {});

  function dataDir(): string {
    const dir = process.env[dataDirEnv] ? path.resolve(process.env[dataDirEnv]!) : path.resolve(process.cwd(), "data");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function uploadsDir(): string {
    const dir = path.join(dataDir(), "uploads");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function databaseFile(): string {
    return process.env[dbFileEnv] ?? path.join(dataDir(), dbFileName);
  }

  function openDatabase(file: string): Database.Database {
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(schemaFor(spec));
    // A field added to the spec after a database was created is a new
    // column; adding it when it is missing is the whole migration story.
    const cols = new Set((db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>).map((c) => c.name));
    for (const field of spec.fields) {
      const column = columnOf(field.key);
      if (!cols.has(column)) db.exec(`ALTER TABLE items ADD COLUMN ${column} ${sqlType(field)}`);
    }
    return db;
  }

  return {
    dataDir,
    uploadsDir,
    databaseFile,
    dbFileName,
    openDatabase,
    building: () => process.env.NEXT_PHASE === "phase-production-build",
    databaseExists: () => Boolean(state().db) || fs.existsSync(databaseFile()),
    getDb() {
      const s = state();
      if (s.locked) throw new Error(s.locked);
      if (!s.db) s.db = openDatabase(databaseFile());
      return s.db;
    },
    setDb(db) {
      state().db = db;
    },
    lockDatabase(reason) {
      const s = state();
      if (s.locked) return false;
      s.locked = reason;
      return true;
    },
    unlockDatabase() {
      state().locked = undefined;
    },
    unlocked: () => state().db,
  };
}
