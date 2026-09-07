import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dataDir, getDb, openDatabase, setDb, uploadsDir } from "./db";
import { isValidUploadName } from "./images";
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

/** Ceilings for an uploaded archive, so a small file cannot expand without bound. */
const RESTORE_LIMITS = { maxTotalBytes: 4 * 1024 * 1024 * 1024, maxEntries: 100_000 };

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
    const check = openDatabase(stagedDb);
    cards = (check.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n;
    check.close();
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true });
    throw new Error(`The database in that archive could not be opened: ${e instanceof Error ? e.message : e}`);
  }

  const root = dataDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const aside = path.join(root, `replaced-${stamp}`);
  await fsp.mkdir(aside, { recursive: true });

  // Close the live connection so the file can be replaced on every platform.
  try {
    getDb().close();
  } catch {
    /* already closed */
  }
  setDb(undefined);

  for (const name of await fsp.readdir(root)) {
    if (name === "uploads" || name.startsWith("replaced-")) continue;
    if (name.startsWith("collectcollect.db")) await fsp.rename(path.join(root, name), path.join(aside, name));
  }
  const uploads = uploadsDir();
  const oldUploads = path.join(aside, "uploads");
  await fsp.mkdir(oldUploads, { recursive: true });
  for (const name of await fsp.readdir(uploads)) {
    await fsp.rename(path.join(uploads, name), path.join(oldUploads, name));
  }

  await fsp.copyFile(stagedDb, path.join(root, "collectcollect.db"));
  for (const photo of photos) await fsp.writeFile(path.join(uploads, photo.name), photo.data);
  await fsp.rm(staging, { recursive: true, force: true });

  // Reopen through the normal path, which also applies any pending migrations.
  getDb();
  return { photos: photos.length, cards, movedAsideTo: aside };
}
