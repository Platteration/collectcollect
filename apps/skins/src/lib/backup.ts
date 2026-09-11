import Database from "better-sqlite3";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DB_FILE, closeDatabase, dataDir, databaseFile, getDb, lockDatabase, openDatabase, unlockDatabase } from "./db";
import { listItems } from "./items";
import { collectionDir, collectionFiles, rebuildCollection } from "./markdown/mirror";
import {
  listReplacedFolders,
  replacedAt,
  replacedFolder,
  swapCollection,
  type SwapDeps,
} from "@collectcollect/core/collection-swap";
import { assertZippable, fileChunks, isSafeEntryName, readZip, zipStream, type ZipEntry } from "@collectcollect/core/zip";

/** What the manifest calls this app, which is how its archives are told from the card app's. */
export const BACKUP_APP = "collectcollect-skins";

/**
 * Everything needed to restore an inventory: a consistent copy of the database
 * and the plain-text copy of it. There are no photos to carry — images are
 * Steam CDN links, recorded rather than stored. The database is copied through
 * SQLite's own backup, so an archive taken while the app is running is never a
 * half-written page or a database missing its write-ahead log; the Markdown is
 * included so the archive is readable by a person even if nothing can open the
 * database any more.
 */
export async function buildBackup(): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "collectcollect-skins-backup-"));
  const dbCopy = path.join(tmpDir, DB_FILE);
  await getDb().backup(dbCopy);

  const entries: ZipEntry[] = [];
  const manifest = Buffer.from(
    JSON.stringify(
      {
        app: BACKUP_APP,
        format: 1,
        createdAt: new Date().toISOString(),
        note: "Restore from Settings, or by stopping the app and unpacking this archive into its data directory. The collection folder holds the same inventory as Markdown, readable without the app.",
      },
      null,
      2,
    ) + "\n",
  );
  entries.push({ name: "manifest.json", size: manifest.length, chunks: () => [new Uint8Array(manifest)] });

  const dbSize = (await fsp.stat(dbCopy)).size;
  entries.push({ name: DB_FILE, size: dbSize, chunks: () => fileChunks(dbCopy) });

  // The Markdown is a bonus inside the archive; the database is the backup. An
  // unreadable collection folder must not cost someone theirs.
  try {
    for (const file of collectionFiles()) {
      entries.push({ name: `collection/${file.name}`, size: file.size, chunks: () => fileChunks(file.path) });
    }
  } catch {
    /* the archive still holds everything needed to restore */
  }

  // Check before a byte goes out: a limit hit halfway through a download
  // leaves the reader with a truncated archive and no idea why.
  assertZippable(entries);

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

  return { filename: `collectcollect-skins-backup-${new Date().toISOString().slice(0, 10)}.zip`, stream };
}

/** A quick description of what a backup would contain, for the Settings page. */
export function backupSummary(): { items: number; databaseBytes: number } {
  const dbFile = (getDb().pragma("database_list") as Array<{ file: string }>)[0]?.file;
  const databaseBytes = dbFile && fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0;
  const items = (getDb().prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
  return { items, databaseBytes };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Ceiling for an uploaded archive. A restore holds the archive and each entry
 * in memory, so this is deliberately well below what the writer can produce;
 * an inventory larger than this is restored by unpacking the zip into the data
 * directory by hand.
 */
export const RESTORE_MAX_BYTES = 256 * 1024 * 1024;
const RESTORE_LIMITS = { maxTotalBytes: RESTORE_MAX_BYTES, maxEntries: 100_000 };

export interface RestoreResult {
  items: number;
  /** Where the inventory that was replaced now lives, in case the restore was a mistake. */
  movedAsideTo: string;
}

/**
 * Replace the current inventory with the contents of a backup archive.
 *
 * Nothing is deleted: the existing database and its plain-text copy are moved
 * aside into a dated folder inside the data directory, so a restore of the
 * wrong file is undone from Settings. The archive is fully validated, and its
 * database is opened and inspected, before anything is moved.
 */
export async function restoreBackup(archive: Uint8Array): Promise<RestoreResult> {
  const entries = await readZip(archive, RESTORE_LIMITS);

  let database: Uint8Array | null = null;
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) throw new Error(`The archive contains an unsafe path: ${entry.name}`);
    if (entry.name === DB_FILE) database = entry.data;
    else if (entry.name === "manifest.json") continue;
    // The Markdown in an archive is a copy of what the database already holds,
    // so it is rewritten from the restored database rather than unpacked.
    else if (entry.name.startsWith("collection/")) continue;
    // The two apps' archives look alike from the outside, and putting a card
    // collection where an inventory goes would be a confusing way to find out.
    else if (entry.name === "collectcollect.db" || entry.name.startsWith("uploads/")) {
      throw new Error("That is a backup of the card app, not of this inventory");
    } else {
      throw new Error(`The archive contains something this app did not write: ${entry.name}`);
    }
  }
  if (!database) throw new Error(`That archive has no ${DB_FILE}, so it is not a backup of this app`);

  // Unpack and check the database before touching anything that exists.
  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), "collectcollect-skins-restore-"));
  const stagedDb = path.join(staging, DB_FILE);
  await fsp.writeFile(stagedDb, database);
  let items = 0;
  try {
    const check = openDatabase(stagedDb);
    items = (check.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
    check.close();
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw new Error(`The database in that archive could not be opened: ${e instanceof Error ? e.message : e}`);
  }

  let movedAsideTo: string;
  try {
    ({ movedAsideTo } = await swapCollection(SWAP, { database: { path: stagedDb, move: false } }));
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
  reopen();
  return { items, movedAsideTo };
}

const SWAP: SwapDeps = { dataDir, databaseFile, closeDatabase, lockDatabase, unlockDatabase, collectionDir };

/**
 * Open the restored database through the normal path, which also applies any
 * pending migrations, and rewrite the plain-text copy to describe it.
 */
function reopen(): void {
  getDb();
  try {
    rebuildCollection(listItems());
  } catch {
    /* the inventory is restored either way; the files can be rebuilt from Settings */
  }
}

// ---------------------------------------------------------------------------
// The inventories a restore replaced
// ---------------------------------------------------------------------------

export interface ReplacedCollection {
  /** The folder's name, which is what `putBack` takes. */
  name: string;
  /** When it was replaced. */
  replacedAt: string;
  items: number | null;
}

/**
 * Every inventory a restore has moved aside, newest first, so a restore of the
 * wrong file is undone from Settings rather than by hand.
 */
export function replacedCollections(): ReplacedCollection[] {
  const root = dataDir();
  return listReplacedFolders(root).map((name) => ({
    name,
    replacedAt: replacedAt(name) ?? "",
    items: countRows(path.join(root, name, DB_FILE), "items"),
  }));
}

/** How many rows a database file holds, read without opening it for writing; null when it cannot be read. */
function countRows(file: string, table: string): number | null {
  if (!fs.existsSync(file)) return null;
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Make a replaced inventory the live one again.
 *
 * The same swap as a restore, run the other way: what is live now goes into a
 * new dated folder, so putting the wrong one back is itself undoable, and the
 * folder named is consumed. Only a name this app wrote is accepted.
 */
export async function putBack(name: string): Promise<RestoreResult> {
  const folder = replacedFolder(dataDir(), name);
  if (!folder || !fs.existsSync(folder)) throw new Error("That is not one of the inventories a restore replaced");
  const database = path.join(folder, DB_FILE);
  if (!fs.existsSync(database)) throw new Error(`${name} holds no database, so there is nothing to put back`);
  const items = countRows(database, "items");
  if (items === null) throw new Error(`The database in ${name} could not be opened`);

  const siblings = fs
    .readdirSync(folder)
    .filter((entry) => entry.startsWith(`${DB_FILE}-`))
    .map((entry) => ({ path: path.join(folder, entry), name: entry }));
  const collection = path.join(folder, "collection");

  const { movedAsideTo } = await swapCollection(SWAP, {
    database: { path: database, move: true, siblings },
    collection: fs.existsSync(collection) ? collection : undefined,
  });
  // Everything of value has been moved out; what is left is an empty shell.
  await fsp.rm(folder, { recursive: true, force: true });
  reopen();
  return { items, movedAsideTo };
}
