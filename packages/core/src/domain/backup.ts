import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DomainDb } from "./db";
import type { Images } from "./images";
import type { Mirror } from "./markdown/mirror";
import { assertZippable, fileChunks, isSafeEntryName, readZip, zipStream, type ZipEntry } from "../zip";
import { isValidUploadName } from "./normalize";

export const RESTORE_MAX_BYTES = 512 * 1024 * 1024;
const RESTORE_LIMITS = { maxTotalBytes: RESTORE_MAX_BYTES, maxEntries: 100_000 };

export interface RestoreResult {
  photos: number;
  items: number;
  movedAsideTo: string;
}

/**
 * Everything needed to restore a collection: a consistent copy of the
 * database (through SQLite's own backup), every uploaded photo, and the
 * plain-text copy, readable even if nothing can open the database any more.
 */
export function createBackup<F extends object>(ctx: { id: string; db: DomainDb; images: Images; mirror: Mirror<F>; rebuild: () => void }) {
  const { id, db, images, mirror } = ctx;

  async function buildBackup(): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `collectcollect-${id}-backup-`));
    const dbCopy = path.join(tmpDir, db.dbFileName);
    await db.getDb().backup(dbCopy);
    const photoNames = await images.listUploads();
    const entries: ZipEntry[] = [];
    const manifest = Buffer.from(
      JSON.stringify(
        {
          app: `collectcollect-${id}`,
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
    entries.push({ name: db.dbFileName, size: (await fsp.stat(dbCopy)).size, chunks: () => fileChunks(dbCopy) });
    const uploads = db.uploadsDir();
    for (const name of photoNames) {
      const full = path.join(uploads, name);
      entries.push({ name: `uploads/${name}`, size: (await fsp.stat(full)).size, chunks: () => fileChunks(full) });
    }
    try {
      for (const file of mirror.collectionFiles()) {
        entries.push({ name: `collection/${file.name}`, size: file.size, chunks: () => fileChunks(file.path) });
      }
    } catch {
      /* the archive still holds everything needed to restore */
    }
    assertZippable(entries);
    const iterator = zipStream(entries);
    const discard = () => void fsp.rm(tmpDir, { recursive: true, force: true });
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await iterator.next();
          if (done) {
            controller.close();
            discard();
          } else controller.enqueue(value);
        } catch (e) {
          controller.error(e);
          discard();
        }
      },
      cancel: discard,
    });
    return { filename: `collectcollect-${id}-backup-${new Date().toISOString().slice(0, 10)}.zip`, stream };
  }

  function backupSummary(): { photos: number; databaseBytes: number; photoBytes: number } {
    const uploads = db.uploadsDir();
    let photos = 0;
    let photoBytes = 0;
    for (const name of fs.existsSync(uploads) ? fs.readdirSync(uploads) : []) {
      if (!isValidUploadName(name)) continue;
      photos++;
      photoBytes += fs.statSync(path.join(uploads, name)).size;
    }
    const dbFile = (db.getDb().pragma("database_list") as Array<{ file: string }>)[0]?.file;
    const databaseBytes = dbFile && fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0;
    return { photos, databaseBytes, photoBytes };
  }

  async function restoreBackup(archive: Uint8Array): Promise<RestoreResult> {
    const entries = await readZip(archive, RESTORE_LIMITS);
    let database: Uint8Array | null = null;
    const photos: Array<{ name: string; data: Uint8Array }> = [];
    for (const entry of entries) {
      if (!isSafeEntryName(entry.name)) throw new Error(`The archive contains an unsafe path: ${entry.name}`);
      if (entry.name === db.dbFileName) database = entry.data;
      else if (entry.name === "manifest.json" || entry.name.startsWith("collection/")) continue;
      else if (entry.name.startsWith("uploads/")) {
        const photo = entry.name.slice("uploads/".length);
        if (!isValidUploadName(photo)) throw new Error(`The archive contains an unexpected photo name: ${photo}`);
        photos.push({ name: photo, data: entry.data });
      } else throw new Error(`The archive contains something this app did not write: ${entry.name}`);
    }
    if (!database) throw new Error(`That archive has no ${db.dbFileName}, so it is not a backup of this app`);

    const staging = await fsp.mkdtemp(path.join(os.tmpdir(), `collectcollect-${id}-restore-`));
    const stagedDb = path.join(staging, db.dbFileName);
    await fsp.writeFile(stagedDb, database);
    let items = 0;
    try {
      const check = db.openDatabase(stagedDb);
      items = (check.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
      check.close();
    } catch (e) {
      await fsp.rm(staging, { recursive: true, force: true });
      throw new Error(`The database in that archive could not be opened: ${e instanceof Error ? e.message : e}`);
    }

    const root = db.dataDir();
    const live = db.databaseFile();
    const aside = path.join(root, `replaced-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    if (!db.lockDatabase("A restore is in progress; try again in a moment.")) {
      await fsp.rm(staging, { recursive: true, force: true });
      throw new Error("A restore is already in progress");
    }
    try {
      await fsp.mkdir(aside, { recursive: true });
      try {
        db.unlocked()?.close();
      } catch {
        /* already closed */
      }
      db.setDb(undefined);
      const liveDir = path.dirname(live);
      const liveName = path.basename(live);
      for (const name of await fsp.readdir(liveDir)) {
        if (name === liveName || name.startsWith(`${liveName}-`)) await fsp.rename(path.join(liveDir, name), path.join(aside, name));
      }
      const uploads = db.uploadsDir();
      const oldUploads = path.join(aside, "uploads");
      await fsp.mkdir(oldUploads, { recursive: true });
      for (const name of await fsp.readdir(uploads)) await fsp.rename(path.join(uploads, name), path.join(oldUploads, name));
      const collection = mirror.collectionDir();
      if (fs.existsSync(collection)) await fsp.rename(collection, path.join(aside, "collection"));
      await fsp.copyFile(stagedDb, live);
      for (const photo of photos) await fsp.writeFile(path.join(uploads, photo.name), photo.data);
    } catch (e) {
      throw new Error(`The restore failed part way through: ${e instanceof Error ? e.message : e}. Your previous collection was moved to ${aside} and can be put back by hand.`);
    } finally {
      await fsp.rm(staging, { recursive: true, force: true });
      db.unlockDatabase();
    }
    db.getDb();
    try {
      ctx.rebuild();
    } catch {
      /* the collection is restored either way; the files can be rebuilt from Settings */
    }
    return { photos: photos.length, items, movedAsideTo: aside };
  }

  return { buildBackup, backupSummary, restoreBackup };
}
