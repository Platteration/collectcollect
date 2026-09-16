import type Database from "better-sqlite3";

type OpenDatabase = (file: string) => Database.Database;
type OpenReadonly = (file: string) => Database.Database;

/** Validate and migrate a private staging copy; never the currently live DB. */
export function prepareDatabase(file: string, rootTable: "cards" | "items", openReadonly: OpenReadonly, openDatabase: OpenDatabase): number {
  const original = openReadonly(file);
  try {
    const version = Number(original.pragma("user_version", { simple: true }));
    if (version > 1) throw new Error(`This backup uses schema version ${version}; upgrade the app before restoring it`);
    const table = original.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(rootTable);
    if (!table) throw new Error(rootTable === "cards" ? "The database is not a card collection: it has no cards table" : "The database is not an inventory: it has no items table");
    assertIntegrity(original);
  } finally { original.close(); }

  const migrated = openDatabase(file);
  let canonical: Database.Database | undefined;
  try {
    canonical = openDatabase(":memory:");
    const tables = canonical.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const quote = '"' + name.replaceAll('"', '""') + '"';
      const expected = canonical.prepare(`PRAGMA table_info(${quote})`).all() as Array<{ name: string }>;
      const actual = migrated.prepare(`PRAGMA table_info(${quote})`).all() as Array<{ name: string }>;
      const names = new Set(actual.map((column) => column.name));
      for (const column of expected) if (!names.has(column.name)) throw new Error(`The backup schema is missing ${name}.${column.name}`);
    }
    assertIntegrity(migrated);
    if ((migrated.pragma("foreign_key_check") as unknown[]).length) throw new Error("The backup contains broken database references");
    const count = (migrated.prepare(`SELECT COUNT(*) AS n FROM ${rootTable}`).get() as { n: number }).n;
    migrated.pragma("wal_checkpoint(TRUNCATE)");
    return count;
  } finally { canonical?.close(); migrated.close(); }
}

function assertIntegrity(db: Database.Database): void {
  const rows = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") throw new Error("The backup database failed its integrity check");
}
