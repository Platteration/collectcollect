import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { listCards } from "./cards";
import { DB_FILE, closeDatabase, dataDir, databaseFile, getDb, openDatabase, lockDatabase, unlockDatabase, uploadsDir } from "./db";
import { isValidUploadName } from "./images";
import { collectionDir, rebuildCollection } from "./markdown/mirror";
import {
  listReplacedFolders,
  replacedAt,
  replacedFolder,
  swapCollection,
  type SwapDeps,
} from "@collectcollect/core/collection-swap";
import { isSafeEntryName, readZip } from "@collectcollect/core/zip";
import { stagedArchive } from "@collectcollect/core/staged-archive";
import { prepareDatabase } from "@collectcollect/core/restore-validation";
import { archiveGate, storageLock } from "./storage";
import { writeSnapshotMarkdown } from "./markdown/snapshot";
import { refreshRunning } from "./pricing/refresh";
export { archiveGate } from "./storage";
import { BusyError } from "@collectcollect/core/gate";
import { createThrottle } from "@collectcollect/core/throttle";

/** What the manifest calls this app, which is how its archives are told from the skins app's. */
export const BACKUP_APP = "collectcollect";

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
export function buildBackup(): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
  return archiveGate.run(async () => {
    const tmpDir = await fsp.mkdtemp(/* turbopackIgnore: true */ path.join(os.tmpdir(), "collectcollect-backup-"));
    try {
      await storageLock.run(async () => {
        const dbCopy = path.join(tmpDir, DB_FILE);
        await getDb().backup(dbCopy);
        const snapshot = new Database(dbCopy, { fileMustExist: true });
        snapshot.pragma("journal_mode = DELETE");
        try {
          const manifest: Record<string, unknown> = { app: BACKUP_APP, format: 1, schemaVersion: snapshot.pragma("user_version", { simple: true }), createdAt: new Date().toISOString() };

          const photos = path.join(tmpDir, "uploads");
          await fsp.mkdir(/* turbopackIgnore: true */ photos);
          const names = (await fsp.readdir(/* turbopackIgnore: true */ uploadsDir())).filter(isValidUploadName).sort();
          for (const name of names) await fsp.copyFile(/* turbopackIgnore: true */ path.join(uploadsDir(), name), path.join(photos, name));
          validatePhotos(snapshot, new Set(names));
          manifest.photos = names.length;
          writeSnapshotMarkdown(snapshot, path.join(tmpDir, "collection"));
          await fsp.writeFile(/* turbopackIgnore: true */ path.join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
        } finally { snapshot.close(); }
      });
      return await stagedArchive(tmpDir, `collectcollect-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (error) { await fsp.rm(/* turbopackIgnore: true */ tmpDir, { recursive: true, force: true }); throw error; }
  });
}

/** A quick description of what a backup would contain, for the Settings page. */
export function backupSummary(): { photos: number; databaseBytes: number; photoBytes: number } {
  const uploads = uploadsDir();
  let photos = 0;
  let photoBytes = 0;
  for (const name of fs.existsSync(/* turbopackIgnore: true */ uploads) ? fs.readdirSync(/* turbopackIgnore: true */ uploads) : []) {
    if (!isValidUploadName(name)) continue;
    photos++;
    photoBytes += fs.statSync(/* turbopackIgnore: true */ path.join(uploads, name)).size;
  }
  const dbFile = (getDb().pragma("database_list") as Array<{ file: string }>)[0]?.file;
  const databaseBytes = dbFile && fs.existsSync(/* turbopackIgnore: true */ dbFile) ? fs.statSync(/* turbopackIgnore: true */ dbFile).size : 0;
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
export function restoreBackup(archive: Uint8Array): Promise<RestoreResult> {
  return archiveGate.run(async () => {
    if (refreshRunning()) throw new BusyError("Wait for the current price refresh before restoring a collection");
    return restoreBackupWithin(archive);
  });
}

async function restoreBackupWithin(archive: Uint8Array): Promise<RestoreResult> {
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
  const staging = await fsp.mkdtemp(/* turbopackIgnore: true */ path.join(os.tmpdir(), "collectcollect-restore-"));
  const stagedDb = path.join(staging, "collectcollect.db");
  let cards: number;
  try {
    await fsp.writeFile(/* turbopackIgnore: true */ stagedDb, database);
    cards = inspectDatabase(stagedDb);
    const stagedUploads = path.join(staging, "uploads");
    await fsp.mkdir(/* turbopackIgnore: true */ stagedUploads);
    for (const photo of photos) await fsp.writeFile(/* turbopackIgnore: true */ path.join(stagedUploads, photo.name), photo.data);
    const snapshot = new Database(stagedDb, { readonly: true });
    try {
      validatePhotos(snapshot, new Set(photos.map((photo) => photo.name)));
      writeSnapshotMarkdown(snapshot, path.join(staging, "collection"));
    } finally { snapshot.close(); }
  } catch (e) {
    await fsp.rm(/* turbopackIgnore: true */ staging, { recursive: true, force: true });
    throw e;
  }

  let movedAsideTo: string;
  try {
    ({ movedAsideTo } = await storageLock.run(() =>
      swapCollection(SWAP, { database: { path: stagedDb, move: false }, uploads: { dir: path.join(staging, "uploads") }, collection: path.join(staging, "collection") }),
    ));
  } finally {
    await fsp.rm(/* turbopackIgnore: true */ staging, { recursive: true, force: true });
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
  let manifest: { app?: unknown; format?: unknown; schemaVersion?: unknown };
  try {
    manifest = JSON.parse(new TextDecoder().decode(data)) as typeof manifest;
    app = manifest?.app;
  } catch {
    return;
  }
  if (typeof app === "string" && app !== BACKUP_APP) {
    throw new Error(`That is a backup of ${app === "collectcollect-skins" ? "the skins app" : app}, not of this collection`);
  }
  if (manifest?.format !== undefined && manifest.format !== 1) throw new Error("Unsupported backup format; upgrade the app before restoring it");
  if (typeof manifest?.schemaVersion === "number" && manifest.schemaVersion > 1) throw new Error("This backup uses a newer schema; upgrade the app before restoring it");
}

/**
 * Inspect the incoming file read-only before migrating its private staging
 * copy. A foreign, corrupt, future-version or incompatible schema never
 * replaces the live collection.
 */
function inspectDatabase(file: string): number {
  try {
    return prepareDatabase(file, "cards", (name) => new Database(name, { readonly: true, fileMustExist: true }), openDatabase);
  } catch (error) {
    throw new Error(`The database in that archive could not be opened: ${error instanceof Error ? error.message : error}`);
  }
}

function validatePhotos(db: Database.Database, photos: Set<string>): void {
  const references = db.prepare("SELECT DISTINCT image_path AS name FROM cards WHERE image_path IS NOT NULL AND image_path != ''").all() as Array<{ name: string }>;
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scan_drafts'").get()) {
    const drafts = db.prepare("SELECT uploads FROM scan_drafts WHERE status NOT IN ('committed','discarded')").all() as Array<{ uploads: string }>;
    for (const draft of drafts) {
      const names: unknown = JSON.parse(draft.uploads);
      if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) throw new Error("A scan draft contains invalid photo references");
      references.push(...names.map((name: string) => ({ name })));
    }
  }
  for (const { name } of references) {
    if (!isValidUploadName(name) || !photos.has(name)) throw new Error(`The collection references a missing photo: ${name}. Include every referenced photo before restoring or backing up.`);
  }
}

const SWAP: SwapDeps = { dataDir, databaseFile, databaseName: DB_FILE, closeDatabase, lockDatabase, unlockDatabase, collectionDir, uploadsDir };

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
      photos: fs.existsSync(/* turbopackIgnore: true */ uploads) ? fs.readdirSync(/* turbopackIgnore: true */ uploads).filter(isValidUploadName).length : 0,
    };
  });
}

/** How many rows a database file holds, read without opening it for writing; null when it cannot be read. */
function countRows(file: string, table: string): number | null {
  if (!fs.existsSync(/* turbopackIgnore: true */ file)) return null;
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
export function putBack(name: string): Promise<RestoreResult> {
  return archiveGate.run(async () => {
    if (refreshRunning()) throw new BusyError("Wait for the current price refresh before restoring a collection");
    const folder = replacedFolder(dataDir(), name);
    if (!folder || !fs.existsSync(/* turbopackIgnore: true */ folder)) throw new Error("That is not one of the collections a restore replaced");
    const database = path.join(folder, DB_FILE);
    if (!fs.existsSync(/* turbopackIgnore: true */ database)) throw new Error(`${name} holds no database, so there is nothing to put back`);
    const staging = await fsp.mkdtemp(/* turbopackIgnore: true */ path.join(os.tmpdir(), "collectcollect-put-back-"));
    try {
      const stagedDb = path.join(staging, DB_FILE);
      // SQLite backup also captures any old WAL files, without consuming the undo point.
      const source = new Database(database, { readonly: true, fileMustExist: true });
      try { await source.backup(stagedDb); } finally { source.close(); }
      const cards = inspectDatabase(stagedDb);

      const sourcePhotos = path.join(folder, "uploads");
      const stagedPhotos = path.join(staging, "uploads");
      await fsp.mkdir(/* turbopackIgnore: true */ stagedPhotos);
      if (fs.existsSync(/* turbopackIgnore: true */ sourcePhotos)) await fsp.cp(/* turbopackIgnore: true */ sourcePhotos, stagedPhotos, { recursive: true });
      const photos = (await fsp.readdir(/* turbopackIgnore: true */ stagedPhotos)).filter(isValidUploadName).length;
      const sourceCollection = path.join(folder, "collection");
      const stagedCollection = path.join(staging, "collection");
      if (fs.existsSync(/* turbopackIgnore: true */ sourceCollection)) await fsp.cp(/* turbopackIgnore: true */ sourceCollection, stagedCollection, { recursive: true });
      const snapshot = new Database(stagedDb, { readonly: true });
      try {
        validatePhotos(snapshot, new Set(await fsp.readdir(/* turbopackIgnore: true */ stagedPhotos)));
        writeSnapshotMarkdown(snapshot, stagedCollection);
      } finally { snapshot.close(); }

      const { movedAsideTo } = await storageLock.run(() => swapCollection(SWAP, { database: { path: stagedDb, move: false }, uploads: { dir: path.join(staging, "uploads") }, collection: stagedCollection }));
      await fsp.rm(/* turbopackIgnore: true */ folder, { recursive: true, force: true });
      reopen();
      return { photos, cards, movedAsideTo };
    } finally { await fsp.rm(/* turbopackIgnore: true */ staging, { recursive: true, force: true }); }
  });
}
