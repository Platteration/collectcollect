import type Database from "better-sqlite3";

type OpenDatabase = (file: string) => Database.Database;
type OpenReadonly = (file: string) => Database.Database;

/** Thrown when the archive's database is not one this app could have written. */
export class ForeignDatabaseError extends Error {
  constructor(what: string) {
    super(`The database in that archive is not one this app wrote: ${what}`);
    this.name = "ForeignDatabaseError";
  }
}

/**
 * Validate and migrate a private staging copy; never the currently live DB.
 * `schemaVersion` is the version this build of the app writes: a backup from a
 * newer one is refused before anything is migrated.
 *
 * A SQLite file carries code as well as rows: a trigger runs whenever the
 * table it watches is written, and a view can stand in for a table. The app
 * opens this file read-write to migrate it, and then writes to it on every
 * edit for as long as it is the live collection, so a trigger installed by a
 * restore is the archive's author choosing what every later edit does. So
 * before anything here writes to the file:
 *
 * - a view is refused, since this app creates none;
 * - a trigger with a name this app does not create is refused;
 * - every trigger and index is then dropped, on a plain connection that runs
 *   nothing of the file's own, and `openDatabase` recreates this app's own —
 *   so one that wears an app's name with another body (an index made UNIQUE
 *   that refuses every later card, a trigger that rewrites them) is replaced
 *   rather than trusted. Indexes and these triggers hold no data of their own.
 *
 * The price history is written by this app's own triggers, which read the
 * newest snapshot's summary as JSON: a summary that is not JSON would make
 * every later price for that card fail, so it is refused here as well.
 */
export function prepareDatabase(
  file: string,
  rootTable: "cards" | "items",
  openReadonly: OpenReadonly,
  openDatabase: OpenDatabase,
  schemaVersion: number,
  openPlain: OpenDatabase,
): number {
  const own = canonicalObjects(openDatabase);
  const original = openReadonly(file);
  try {
    const version = Number(original.pragma("user_version", { simple: true }));
    if (version > schemaVersion) throw new Error(`This backup uses schema version ${version}; upgrade the app before restoring it`);
    const table = original.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(rootTable);
    if (!table) throw new Error(rootTable === "cards" ? "The database is not a card collection: it has no cards table" : "The database is not an inventory: it has no items table");
    assertIntegrity(original);
    for (const object of original.prepare("SELECT name, type FROM sqlite_master").all() as Array<{ name: string; type: string }>) {
      if (object.name.startsWith("sqlite_")) continue;
      if (object.type === "view") throw new ForeignDatabaseError(`it carries a view called "${object.name}", and this app creates none`);
      if (object.type === "trigger" && own.get(object.name) !== "trigger") {
        throw new ForeignDatabaseError(`it carries a trigger called "${object.name}" that this app does not create`);
      }
    }
    const snapshots = original.prepare("SELECT 1 FROM pragma_table_info('price_snapshots') WHERE name = 'summary'").get();
    if (snapshots) {
      const bad = original.prepare("SELECT id FROM price_snapshots WHERE NOT json_valid(summary) LIMIT 1").get() as { id: number } | undefined;
      if (bad) throw new ForeignDatabaseError(`price snapshot ${bad.id} has a summary that is not JSON`);
    }
  } finally { original.close(); }

  // Nothing above wrote; dropping a trigger or an index fires nothing either.
  const plain = openPlain(file);
  try {
    const derived = plain.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('trigger', 'index') AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string; type: string }>;
    for (const { name, type } of derived) plain.exec(`DROP ${type === "trigger" ? "TRIGGER" : "INDEX"} IF EXISTS ${quoteName(name)}`);
  } finally { plain.close(); }

  const migrated = openDatabase(file);
  let canonical: Database.Database | undefined;
  try {
    canonical = openDatabase(":memory:");
    const tables = canonical.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const quote = quoteName(name);
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

/** Every object this app's own schema creates, by name, as sqlite_master types it. */
function canonicalObjects(openDatabase: OpenDatabase): Map<string, string> {
  const probe = openDatabase(":memory:");
  try {
    const rows = probe.prepare("SELECT name, type FROM sqlite_master").all() as Array<{ name: string; type: string }>;
    return new Map(rows.map((row) => [row.name, row.type]));
  } finally { probe.close(); }
}

const quoteName = (name: string) => '"' + name.replaceAll('"', '""') + '"';

function assertIntegrity(db: Database.Database): void {
  const rows = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") throw new Error("The backup database failed its integrity check");
}
