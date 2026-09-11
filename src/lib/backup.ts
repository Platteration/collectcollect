import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { dataDir, databaseFile, getDb, lockDatabase, openStagedDatabase, ownSchema, setDb, unlockDatabase, uploadsDir } from "./db";
import { httpUrl } from "./format";
import { isValidUploadName } from "./images";
import { MAX_REQUEST_BYTES } from "./limits";
import { ALERT_KINDS, CONDITIONS, GAMES, GRADING_STATUSES, SUBMISSION_STATUSES, has } from "./types";
import { isSafeEntryName, readZip, zipStream, type ZipEntry } from "./zip";

/**
 * Everything needed to restore a collection: a consistent copy of the database
 * plus every uploaded photo. The database is copied through SQLite's own
 * backup, so an archive taken while the app is running is never a half-written
 * page or a database missing its write-ahead log.
 */
export async function buildBackup(): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "collectcollect-backup-"));
  const dbCopy = path.join(tmpDir, "collectcollect.db");
  await getDb().backup(dbCopy);

  const uploads = uploadsDir();
  const photoNames = (await fsp.readdir(uploads).catch(() => [] as string[])).filter(isValidUploadName).sort();

  const entries: ZipEntry[] = [];
  const manifest = Buffer.from(
    JSON.stringify(
      {
        app: "collectcollect",
        format: 1,
        createdAt: new Date().toISOString(),
        photos: photoNames.length,
        note: "Restore by stopping the app and unpacking this archive into its data directory.",
      },
      null,
      2,
    ) + "\n",
  );
  entries.push({ name: "manifest.json", size: manifest.length, chunks: () => [new Uint8Array(manifest)] });

  const dbSize = (await fsp.stat(dbCopy)).size;
  entries.push({ name: "collectcollect.db", size: dbSize, chunks: () => fileChunks(dbCopy) });

  for (const name of photoNames) {
    const full = path.join(uploads, name);
    const size = (await fsp.stat(full)).size;
    entries.push({ name: `uploads/${name}`, size, chunks: () => fileChunks(full) });
  }

  const iterator = zipStream(entries);
  // The database copy lives in a temp directory for as long as the download
  // takes; it is removed when the stream ends, fails, or the client gives up.
  const discard = () => void fsp.rm(tmpDir, { recursive: true, force: true });
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          discard();
        } else {
          controller.enqueue(value);
        }
      } catch (e) {
        controller.error(e);
        discard();
      }
    },
    cancel: discard,
  });

  return { filename: `collectcollect-backup-${new Date().toISOString().slice(0, 10)}.zip`, stream };
}

/** The live connection without going through the restore lock. */
function getDbUnlocked() {
  return (globalThis as unknown as { __collectcollectDb?: { close: () => void } }).__collectcollectDb;
}

async function* fileChunks(file: string): AsyncGenerator<Uint8Array> {
  const handle = await fsp.open(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) return;
      yield new Uint8Array(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
}

/** Every `replaced-<timestamp>` folder a restore left behind, and what they cost. */
export function replacedCollections(): { folders: string[]; bytes: number } {
  const root = dataDir();
  const folders = (fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [])
    .filter((e) => e.isDirectory() && e.name.startsWith("replaced-"))
    .map((e) => e.name)
    .sort();
  let bytes = 0;
  for (const name of folders) bytes += directoryBytes(path.join(root, name));
  return { folders, bytes };
}

function directoryBytes(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directoryBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

/** A quick description of what a backup would contain, for the Settings page. */
export function backupSummary(): {
  photos: number;
  databaseBytes: number;
  photoBytes: number;
  /** What previous restores are still holding on to; nothing removes these on its own. */
  replaced: { folders: number; bytes: number };
} {
  const uploads = uploadsDir();
  let photos = 0;
  let photoBytes = 0;
  for (const name of fs.existsSync(uploads) ? fs.readdirSync(uploads) : []) {
    if (!isValidUploadName(name)) continue;
    photos++;
    photoBytes += fs.statSync(path.join(uploads, name)).size;
  }
  const dbFile = (getDb().pragma("database_list") as Array<{ file: string }>)[0]?.file;
  const databaseBytes = dbFile && fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0;
  const replaced = replacedCollections();
  return { photos, databaseBytes, photoBytes, replaced: { folders: replaced.folders.length, bytes: replaced.bytes } };
}


// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Ceilings for an uploaded archive. A restore holds the archive and each entry
 * in memory, so this is deliberately well below what the writer can produce; a
 * collection larger than this is restored by unpacking the zip into the data
 * directory by hand. It is the same number the proxy's body buffer is set to
 * (src/lib/limits.ts): a larger ceiling here would be unenforceable, because
 * anything over that buffer reaches the route truncated rather than refused.
 */
export const RESTORE_MAX_BYTES = MAX_REQUEST_BYTES;
const RESTORE_LIMITS = { maxTotalBytes: RESTORE_MAX_BYTES, maxEntries: 100_000 };

export interface RestoreOptions {
  /**
   * Called once the archive is known to be a zip and before its entries are
   * inflated — the moment a restore starts to cost anything. The route spends
   * its rate-limit slot here rather than at the door, so a file that is not
   * even an archive costs the owner nothing. Throwing abandons the restore.
   */
  beforeInflate?: () => void;
}

export interface RestoreResult {
  photos: number;
  cards: number;
  /** Where the collection that was replaced now lives, in case the restore was a mistake. */
  movedAsideTo: string;
}

/** Thrown when the archive is a database, but not one this app could have written. */
class ArchiveContentError extends Error {}

/**
 * Every check the write path makes, applied to the database inside an archive —
 * to its schema first, and then to its rows.
 *
 * The archive is written by whoever hands the owner a file, and the only thing
 * once asked of its database was that `SELECT COUNT(*) FROM cards` ran: less
 * than POST /api/cards asks of a single card. Its rows are then rendered by
 * every page, so a game of `__proto__`, a summary that is not JSON, or a
 * `reference_image_url` of `javascript:...` is installed over the live
 * collection and breaks or poisons the app with no way back through the UI.
 *
 * The schema matters just as much as the rows, and for a worse reason. A SQLite
 * file carries executable code: a trigger runs whenever the table it watches is
 * written, so a trigger installed by a restore is the archive's author choosing
 * what every later card edit does. A view can replace a table this app reads.
 * Neither is anything a backup of this app contains, so anything in
 * sqlite_master this app's own schema does not create is refused — as is a
 * table of ours whose columns are not ours, since the pages read those by name.
 *
 * This runs on the staging copy, through a read-only connection (see
 * openStagedDatabase) and before anything live is moved aside, and refuses the
 * whole archive rather than quietly repairing it: a backup whose schema and rows
 * do not hold up is not this app's backup.
 */
function validateStagedDatabase(db: Database.Database): void {
  const refuse = (what: string): never => {
    throw new ArchiveContentError(`The database in that archive is not one this app wrote: ${what}`);
  };
  const parsed = (text: string | null): { ok: boolean; value: unknown } => {
    if (text === null) return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, value: null };
    }
  };
  const isJson = (text: string | null): boolean => parsed(text).ok;
  const isNumber = (v: unknown): boolean => v === null || typeof v === "number";

  // --- the schema ----------------------------------------------------------
  const own = ownSchema();
  const objects = db.prepare("SELECT name, type FROM sqlite_master").all() as Array<{ name: string; type: string }>;
  for (const object of objects) {
    // SQLite's own bookkeeping (sqlite_sequence, the autoindexes behind UNIQUE
    // constraints). No DDL can create these names, so they carry nothing.
    if (object.name.startsWith("sqlite_")) continue;
    if (object.type === "trigger" || object.type === "view") {
      refuse(`it carries a ${object.type} called "${object.name}", and this app creates neither`);
    }
    if (own.objects.get(object.name) !== object.type) {
      refuse(`it carries a ${object.type} called "${object.name}" that this app does not create`);
    }
  }

  const tables = new Set(objects.filter((o) => o.type === "table").map((o) => o.name));
  if (!tables.has("cards")) refuse("it has no cards table, so it is not a collection");
  const columnsOf = (table: string): Set<string> =>
    new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name));
  const present = new Map<string, Set<string>>();
  for (const table of tables) {
    if (table.startsWith("sqlite_")) continue;
    const columns = columnsOf(table);
    present.set(table, columns);
    for (const column of own.columns.get(table) ?? []) {
      // A column a later version added may be missing from an older backup; the
      // live open adds it back. Anything else means a table wearing our name.
      if (!columns.has(column) && !own.addedLater.has(`${table}.${column}`)) {
        refuse(`its ${table} table has no ${column} column`);
      }
    }
  }
  /** Read `columns` from `table`, skipping the ones an older backup may not have. */
  const rows = <T>(table: string, columns: string[]): T[] => {
    if (!tables.has(table)) return [];
    const here = present.get(table) ?? new Set<string>();
    const wanted = columns.filter((c) => here.has(c));
    return db.prepare(`SELECT ${wanted.map((c) => `"${c}"`).join(", ")} FROM "${table}"`).all() as T[];
  };

  // --- the rows ------------------------------------------------------------
  const cards = rows<{ id: number } & Record<string, string | null>>("cards", [
    "id",
    "game",
    "condition",
    "grading_status",
    "accent_color",
    "image_path",
    "reference_image_url",
    "external_ids",
    "identification",
    "manual_graded",
  ]);
  for (const row of cards) {
    const at = `card ${row.id}`;
    if (!has(GAMES, row.game)) refuse(`${at} has an unknown game "${row.game}"`);
    if (!has(CONDITIONS, row.condition)) refuse(`${at} has an unknown condition "${row.condition}"`);
    if ("grading_status" in row && !has(GRADING_STATUSES, row.grading_status)) refuse(`${at} has an unknown grading status "${row.grading_status}"`);
    if (row.accent_color != null && !/^#[0-9a-f]{6}$/i.test(row.accent_color)) refuse(`${at} has an accent colour that is not a #rrggbb literal`);
    if (row.image_path != null && !isValidUploadName(row.image_path)) refuse(`${at} names a photo this app could not have stored`);
    if (row.reference_image_url != null && !httpUrl(row.reference_image_url)) refuse(`${at} has a reference image URL that is not http(s)`);
    for (const column of ["external_ids", "identification", "manual_graded"] as const) {
      if (!isJson(row[column])) refuse(`${at} has a ${column} column that is not JSON`);
    }
  }

  // The columns every page parses on the way out, none of which has anywhere to
  // report a failure from.
  for (const row of rows<{ id: number; summary: string }>("price_snapshots", ["id", "summary"])) {
    if (!isJson(row.summary)) refuse(`price snapshot ${row.id} has a summary that is not JSON`);
  }
  for (const row of rows<{ id: number; cards: string }>("set_checklists", ["id", "cards"])) {
    if (!isJson(row.cards) || !Array.isArray(JSON.parse(row.cards))) refuse(`set checklist ${row.id} does not hold a list of cards`);
  }
  // The alerts page reads `kind` as the key of its label and its badge class,
  // and it is the page an alert has to be dismissed from: a kind this app never
  // writes leaves that one page answering 500 with no way back through the UI.
  for (const row of rows<{ id: number; kind: string }>("alerts", ["id", "kind"])) {
    if (!has(ALERT_KINDS, row.kind)) refuse(`alert ${row.id} has an unknown kind "${row.kind}"`);
  }
  for (const row of rows<{ id: number; status: string; fee_per_card: unknown; shipping: unknown }>("submissions", [
    "id",
    "status",
    "fee_per_card",
    "shipping",
  ])) {
    if (!has(SUBMISSION_STATUSES, row.status)) refuse(`submission ${row.id} has an unknown status "${row.status}"`);
    if (!isNumber(row.fee_per_card) || !isNumber(row.shipping)) refuse(`submission ${row.id} has a fee or shipping cost that is not a number`);
  }
  // Money that is not a number reaches the report and the portfolio as a total
  // of NaN, which is a wrong answer rather than an error: nothing downstream
  // would report it.
  for (const row of rows<{ id: number } & Record<string, unknown>>("sales", ["id", "quantity", "unit_price", "fees", "unit_cost"])) {
    for (const column of ["quantity", "unit_price", "fees", "unit_cost"]) {
      if (column in row && !isNumber(row[column])) refuse(`sale ${row.id} has a ${column} that is not a number`);
    }
  }
  for (const row of rows<{ id: number } & Record<string, unknown>>("submission_cards", ["id", "raw_value", "expected_value", "returned_value"])) {
    for (const column of ["raw_value", "expected_value", "returned_value"]) {
      if (column in row && !isNumber(row[column])) refuse(`submission card ${row.id} has a ${column} that is not a number`);
    }
  }
  for (const row of rows<{ key: string; value: string }>("settings", ["key", "value"])) {
    const value = parsed(row.value);
    if (!value.ok || typeof value.value !== "object" || value.value === null || Array.isArray(value.value)) {
      refuse(`the "${row.key}" settings row does not hold a settings object`);
    }
  }
}

/**
 * Replace the current collection with the contents of a backup archive.
 *
 * Nothing is deleted: the existing database and photos are moved aside into a
 * timestamped folder inside the data directory, so a restore of the wrong file
 * is recoverable by hand. The archive is fully validated, and its database is
 * opened and inspected, before anything is moved.
 */
export async function restoreBackup(archive: Uint8Array, options: RestoreOptions = {}): Promise<RestoreResult> {
  const entries = await readZip(archive, { ...RESTORE_LIMITS, beforeInflate: options.beforeInflate });

  let database: Uint8Array | null = null;
  const photos: Array<{ name: string; data: Uint8Array }> = [];
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) throw new Error(`The archive contains an unsafe path: ${entry.name}`);
    if (entry.name === "collectcollect.db") database = entry.data;
    else if (entry.name === "manifest.json") continue;
    else if (entry.name.startsWith("uploads/")) {
      const photo = entry.name.slice("uploads/".length);
      if (!isValidUploadName(photo)) throw new Error(`The archive contains an unexpected photo name: ${photo}`);
      photos.push({ name: photo, data: entry.data });
    } else {
      throw new Error(`The archive contains something this app did not write: ${entry.name}`);
    }
  }
  if (!database) throw new Error("That archive has no collectcollect.db, so it is not a CollectCollect backup");

  // Unpack and check the database before touching anything that exists.
  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), "collectcollect-restore-"));
  const stagedDb = path.join(staging, "collectcollect.db");
  await fsp.writeFile(stagedDb, database);
  let cards = 0;
  try {
    // Read-only: nothing this app runs against a file someone else wrote may
    // write to it, because a write is what fires the file's own triggers.
    const check = openStagedDatabase(stagedDb);
    try {
      validateStagedDatabase(check);
      cards = (check.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n;
    } finally {
      check.close();
    }
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true });
    // A row that does not hold up already says which row and why; anything else
    // means the file is not a database at all.
    if (e instanceof ArchiveContentError) throw e;
    throw new Error(`The database in that archive could not be opened: ${e instanceof Error ? e.message : e}`);
  }

  const root = dataDir();
  const live = databaseFile();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const aside = path.join(root, `replaced-${stamp}`);

  if (!lockDatabase("A restore is in progress; try again in a moment.")) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw new Error("A restore is already in progress");
  }

  try {
    await fsp.mkdir(aside, { recursive: true });
    // Close the live connection so the file can be replaced on every platform.
    try {
      getDbUnlocked()?.close();
    } catch {
      /* already closed */
    }
    setDb(undefined);

    // The database may live outside the data directory when DATABASE_FILE is
    // set, so move the live file and its write-ahead siblings by their own path.
    const liveDir = path.dirname(live);
    const liveName = path.basename(live);
    for (const name of await fsp.readdir(liveDir)) {
      if (name === liveName || name.startsWith(`${liveName}-`)) {
        await fsp.rename(path.join(liveDir, name), path.join(aside, name));
      }
    }
    const uploads = uploadsDir();
    const oldUploads = path.join(aside, "uploads");
    await fsp.mkdir(oldUploads, { recursive: true });
    for (const name of await fsp.readdir(uploads)) {
      await fsp.rename(path.join(uploads, name), path.join(oldUploads, name));
    }

    await fsp.copyFile(stagedDb, live);
    for (const photo of photos) await fsp.writeFile(path.join(uploads, photo.name), photo.data);
  } catch (e) {
    // Past this point the old collection is already in `aside`, so say so
    // plainly rather than leaving someone to guess where it went.
    throw new Error(
      `The restore failed part way through: ${e instanceof Error ? e.message : e}. Your previous collection was moved to ${aside} and can be put back by hand.`,
    );
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
    unlockDatabase();
  }

  // Reopen through the normal path, which also applies any pending migrations.
  getDb();
  return { photos: photos.length, cards, movedAsideTo: aside };
}
