import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { listCards } from "./cards";
import { DB_FILE, closeDatabase, dataDir, databaseFile, getDb, lockDatabase, unlockDatabase, uploadsDir } from "./db";
import { isValidUploadName } from "./images";
import { collectionDir, collectionFiles, rebuildCollection } from "./markdown/mirror";
import {
  listReplacedFolders,
  replacedAt,
  replacedFolder,
  swapCollection,
  type SwapDeps,
} from "@collectcollect/core/collection-swap";
import { assertZippable, fileChunks, isSafeEntryName, readZip, zipStream, type ZipEntry } from "@collectcollect/core/zip";
import { createGate, type Gate } from "@collectcollect/core/gate";
import { createThrottle } from "@collectcollect/core/throttle";

/** What the manifest calls this app, which is how its archives are told from the skins app's. */
export const BACKUP_APP = "collectcollect";

/**
 * A backup copies the database and a restore swaps it out; one running under
 * the other would copy half of each. Held on the global object so a
 * development reload cannot make two.
 */
const globalForGate = globalThis as unknown as { __collectcollectArchiveGate?: Gate };
export const archiveGate: Gate = (globalForGate.__collectcollectArchiveGate ??= createGate("A backup or restore is already running; try again in a moment"));

/**
 * A restore swaps the whole database out, and putting a replaced one back is
 * the same swap the other way. Restore, put back, restore the right file this
 * time: that is a real minute's work, and six leaves room for it while still
 * being nothing to a loop.
 */
export const restoreThrottle = createThrottle(6, 60_000, "restores");

/**
 * Everything needed to restore a collection: a consistent copy of the database,
 * every uploaded photo, and the plain-text copy of the catalogue. The database
 * is copied through SQLite's own backup, so an archive taken while the app is
 * running is never a half-written page or a database missing its write-ahead
 * log. The Markdown is included so that an archive is readable by a person
 * even if nothing can open the database any more.
 */
export async function buildBackup(): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "collectcollect-backup-"));
  const dbCopy = path.join(tmpDir, "collectcollect.db");
  try {
    await archiveGate.run(() => getDb().backup(dbCopy));
  } catch (e) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    throw e;
  }

  const uploads = uploadsDir();
  const photoNames = (await fsp.readdir(uploads).catch(() => [] as string[])).filter(isValidUploadName).sort();

  const entries: ZipEntry[] = [];
  const manifest = Buffer.from(
    JSON.stringify(
      {
        app: BACKUP_APP,
        format: 1,
        createdAt: new Date().toISOString(),
        photos: photoNames.length,
        note: "Restore by stopping the app and unpacking this archive into its data directory. The collection folder holds the same catalogue as Markdown, readable without the app.",
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

  // The Markdown is a bonus inside the archive; the database and the photos are
  // the backup. An unreadable collection folder must not cost someone theirs.
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

  return { filename: `collectcollect-backup-${new Date().toISOString().slice(0, 10)}.zip`, stream };
}

/** A quick description of what a backup would contain, for the Settings page. */
export function backupSummary(): { photos: number; databaseBytes: number; photoBytes: number } {
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
  return { photos, databaseBytes, photoBytes };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Ceilings for an uploaded archive. A restore holds the archive and each
 * entry in memory, so this is deliberately well below what the writer can
 * produce; a collection larger than this is restored by unpacking the zip into
 * the data directory by hand.
 */
export const RESTORE_MAX_BYTES = 512 * 1024 * 1024;
const RESTORE_LIMITS = { maxTotalBytes: RESTORE_MAX_BYTES, maxEntries: 100_000 };

export interface RestoreResult {
  photos: number;
  cards: number;
  /** Where the collection that was replaced now lives, in case the restore was a mistake. */
  movedAsideTo: string;
}

/**
 * Replace the current collection with the contents of a backup archive.
 *
 * Nothing is deleted: the existing database and photos are moved aside into a
 * timestamped folder inside the data directory, so a restore of the wrong file
 * is recoverable by hand. The archive is fully validated, and its database is
 * opened and inspected, before anything is moved.
 */
export async function restoreBackup(archive: Uint8Array): Promise<RestoreResult> {
  const entries = await readZip(archive, RESTORE_LIMITS);

  let database: Uint8Array | null = null;
  const photos: Array<{ name: string; data: Uint8Array }> = [];
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) throw new Error(`The archive contains an unsafe path: ${entry.name}`);
    if (entry.name === "collectcollect.db") database = entry.data;
    else if (entry.name === "manifest.json") assertOwnManifest(entry.data);
    // The skins app's backup is the likeliest wrong file, and says so by name.
    else if (entry.name === "collectcollect-skins.db") throw new Error("That is a backup of the skins app, not of this collection");
    // The Markdown in an archive is a copy of what the database already holds,
    // so it is rewritten from the restored database rather than unpacked.
    else if (entry.name.startsWith("collection/")) continue;
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
  let cards: number;
  try {
    cards = inspectDatabase(stagedDb);
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw e;
  }

  let movedAsideTo: string;
  try {
    ({ movedAsideTo } = await archiveGate.run(() =>
      swapCollection(SWAP, { database: { path: stagedDb, move: false }, uploads: { photos } }),
    ));
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
  reopen();
  return { photos: photos.length, cards, movedAsideTo };
}

/**
 * A manifest that names another app is the clearest sign an archive is the
 * wrong one, and is checked before anything else is. One that cannot be read
 * is ignored: the database is what a restore is really made of.
 */
function assertOwnManifest(data: Uint8Array): void {
  let app: unknown;
  try {
    app = (JSON.parse(new TextDecoder().decode(data)) as { app?: unknown }).app;
  } catch {
    return;
  }
  if (typeof app === "string" && app !== BACKUP_APP) {
    throw new Error(`That is a backup of ${app === "collectcollect-skins" ? "the skins app" : app}, not of this collection`);
  }
}

/**
 * Look inside a database file without changing it. Opening it the normal way
 * would create this app's tables in whatever file was uploaded and report it
 * as an empty collection; opened read-only, a file that is not a database, or
 * is some other app's, is refused as such.
 */
function inspectDatabase(file: string): number {
  let db: Database.Database;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch (e) {
    throw new Error(`The database in that archive could not be opened: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
    if (!tables.includes("cards")) throw new Error("The database in that archive is not a card collection: it has no cards table");
    return (db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n;
  } catch (e) {
    if (e instanceof Error && /not a card collection/.test(e.message)) throw e;
    throw new Error(`The database in that archive could not be opened: ${e instanceof Error ? e.message : e}`);
  } finally {
    db.close();
  }
}

const SWAP: SwapDeps = { dataDir, databaseFile, closeDatabase, lockDatabase, unlockDatabase, collectionDir, uploadsDir };

/**
 * Open the restored database through the normal path, which also applies any
 * pending migrations, and rewrite the plain-text copy to describe it.
 */
function reopen(): void {
  getDb();
  try {
    rebuildCollection(listCards());
  } catch {
    /* the collection is restored either way; the files can be rebuilt from Settings */
  }
}

// ---------------------------------------------------------------------------
// The collections a restore replaced
// ---------------------------------------------------------------------------

export interface ReplacedCollection {
  /** The folder's name, which is what `putBack` takes. */
  name: string;
  /** When it was replaced. */
  replacedAt: string;
  cards: number | null;
  photos: number;
}

/**
 * Every collection a restore has moved aside, newest first, so a restore of the
 * wrong file is undone from Settings rather than by hand.
 */
export function replacedCollections(): ReplacedCollection[] {
  const root = dataDir();
  return listReplacedFolders(root).map((name) => {
    const folder = path.join(root, name);
    const uploads = path.join(folder, "uploads");
    return {
      name,
      replacedAt: replacedAt(name) ?? "",
      cards: countRows(path.join(folder, DB_FILE), "cards"),
      photos: fs.existsSync(uploads) ? fs.readdirSync(uploads).filter(isValidUploadName).length : 0,
    };
  });
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
 * Make a replaced collection the live one again.
 *
 * The same swap as a restore, run the other way: what is live now goes into a
 * new dated folder, so putting the wrong one back is itself undoable, and the
 * folder named is consumed. Only a name this app wrote is accepted.
 */
export async function putBack(name: string): Promise<RestoreResult> {
  const folder = replacedFolder(dataDir(), name);
  if (!folder || !fs.existsSync(folder)) throw new Error("That is not one of the collections a restore replaced");
  const database = path.join(folder, DB_FILE);
  if (!fs.existsSync(database)) throw new Error(`${name} holds no database, so there is nothing to put back`);
  const cards = countRows(database, "cards");
  if (cards === null) throw new Error(`The database in ${name} could not be opened`);

  const siblings = fs
    .readdirSync(folder)
    .filter((entry) => entry.startsWith(`${DB_FILE}-`))
    .map((entry) => ({ path: path.join(folder, entry), name: entry }));
  const uploads = path.join(folder, "uploads");
  const collection = path.join(folder, "collection");
  const photos = fs.existsSync(uploads) ? fs.readdirSync(uploads).length : 0;

  const { movedAsideTo } = await archiveGate.run(() =>
    swapCollection(SWAP, {
      database: { path: database, move: true, siblings },
      uploads: fs.existsSync(uploads) ? { dir: uploads } : { photos: [] },
      collection: fs.existsSync(collection) ? collection : undefined,
    }),
  );
  // Everything of value has been moved out; what is left is an empty shell.
  await fsp.rm(folder, { recursive: true, force: true });
  reopen();
  return { photos, cards, movedAsideTo };
}
