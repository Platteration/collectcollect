import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Replacing a whole collection on disk without ever being left with none.
 *
 * Both apps restore a backup the same way: the collection being replaced is
 * moved into a dated folder beside the data, and the incoming one takes its
 * place. The order matters more than it looks. Copying the new database into
 * place *after* moving the old one aside means a copy that fails — a full disk
 * is the usual way — leaves no database at all, and the next request opens an
 * empty one and reports an empty collection. So the incoming database is
 * brought beside the live one first, where a copy can still fail harmlessly,
 * and the swap itself is two renames, which do not run out of disk.
 *
 * A failure before the swap puts everything back and says nothing was changed.
 * A failure after it leaves the restored database live and names the folder
 * holding the previous collection, so nothing is lost either way.
 */

export interface SwapDeps {
  /** The directory the dated folders are made in. */
  dataDir(): string;
  /** The live database file, wherever it is. */
  databaseFile(): string;
  /** Close and forget the live connection, so the file can be replaced on every platform. */
  closeDatabase(): void;
  /** Refuse new connections while the file is being swapped; false when one is already under way. */
  lockDatabase(reason: string): boolean;
  unlockDatabase(): void;
  /** The plain-text copy of the collection, which belongs to the collection it describes. */
  collectionDir(): string;
  /** Uploaded photos, where the app has them. */
  uploadsDir?: () => string;
}

export interface Incoming {
  database: {
    /** The main database file. */
    path: string;
    /** Whether it may be moved into place rather than copied; true when it is on the same disk and is not needed afterwards. */
    move: boolean;
    /** Write-ahead files that travel with it. */
    siblings?: Array<{ path: string; name: string }>;
  };
  /** A directory of photos to move into place, or photos held in memory to write. */
  uploads?: { dir: string } | { photos: Array<{ name: string; data: Uint8Array }> };
  /** A collection folder to move into place. Left out, the caller rebuilds one. */
  collection?: string;
}

export interface SwapResult {
  /** Where the collection that was replaced now lives. */
  movedAsideTo: string;
}

/** The dated folders a swap leaves behind: `replaced-<ISO stamp with : and . as ->`. */
export const REPLACED_NAME = /^replaced-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export function replacedFolderName(now = new Date()): string {
  return `replaced-${now.toISOString().replace(/[:.]/g, "-")}`;
}

/** When a dated folder was made, read back out of its name. */
export function replacedAt(name: string): string | null {
  if (!REPLACED_NAME.test(name)) return null;
  const stamp = name.slice("replaced-".length);
  // 2026-09-11T02-46-08-123Z -> 2026-09-11T02:46:08.123Z
  const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/**
 * The dated folders in the data directory, newest first. Only names this
 * module writes are listed, so a stray folder someone made by hand is never
 * offered as something to put back.
 */
export function listReplacedFolders(dataDir: string): string[] {
  if (!fs.existsSync(dataDir)) return [];
  return fs
    .readdirSync(dataDir)
    .filter((name) => REPLACED_NAME.test(name) && fs.statSync(path.join(dataDir, name)).isDirectory())
    .sort()
    .reverse();
}

/** The path of a dated folder, or null when the name is not one this module wrote. */
export function replacedFolder(dataDir: string, name: string): string | null {
  return REPLACED_NAME.test(name) ? path.join(dataDir, name) : null;
}

export async function swapCollection(deps: SwapDeps, incoming: Incoming): Promise<SwapResult> {
  const root = deps.dataDir();
  const live = deps.databaseFile();
  const liveDir = path.dirname(live);
  const liveName = path.basename(live);
  const aside = path.join(root, replacedFolderName());
  const staged = `${live}.restoring`;

  if (!deps.lockDatabase("A restore is in progress; try again in a moment.")) {
    throw new Error("A restore is already in progress");
  }

  /** Every rename made before the swap, so they can be undone in reverse. */
  const moved: Array<{ from: string; to: string }> = [];
  const move = async (from: string, to: string) => {
    await fsp.rename(from, to);
    moved.push({ from, to });
  };
  let swapped = false;

  try {
    await fsp.mkdir(aside, { recursive: true });
    // Bring the incoming database beside the live one before anything moves.
    // This is the step that can run out of disk, and here that costs nothing.
    if (incoming.database.move) await fsp.rename(incoming.database.path, staged);
    else await fsp.copyFile(incoming.database.path, staged);

    deps.closeDatabase();

    // The database may live outside the data directory, so the live file and
    // its write-ahead siblings are moved by their own path.
    for (const name of await fsp.readdir(liveDir)) {
      if (name === liveName || name.startsWith(`${liveName}-`)) {
        await move(path.join(liveDir, name), path.join(aside, name));
      }
    }
    await fsp.rename(staged, live);
    swapped = true;
    for (const sibling of incoming.database.siblings ?? []) {
      await fsp.rename(sibling.path, path.join(liveDir, sibling.name));
    }

    if (deps.uploadsDir) {
      const uploads = deps.uploadsDir();
      const oldUploads = path.join(aside, "uploads");
      await fsp.mkdir(oldUploads, { recursive: true });
      for (const name of await fsp.readdir(uploads)) {
        await fsp.rename(path.join(uploads, name), path.join(oldUploads, name));
      }
      if (incoming.uploads && "dir" in incoming.uploads) {
        for (const name of await fsp.readdir(incoming.uploads.dir)) {
          await fsp.rename(path.join(incoming.uploads.dir, name), path.join(uploads, name));
        }
      } else if (incoming.uploads) {
        for (const photo of incoming.uploads.photos) await fsp.writeFile(path.join(uploads, photo.name), photo.data);
      }
    }

    // The plain-text copy belongs to the collection being replaced, and the
    // promise is that nothing is deleted, so it goes aside with the rest.
    const collection = deps.collectionDir();
    if (fs.existsSync(collection)) await fsp.rename(collection, path.join(aside, "collection"));
    if (incoming.collection && fs.existsSync(incoming.collection)) await fsp.rename(incoming.collection, collection);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (swapped) {
      // Past this point the restored database is the live one and the old
      // collection is in `aside`, so say so plainly rather than leaving someone
      // to guess where it went.
      throw new Error(
        `The restore failed part way through: ${reason}. The restored database is in place; your previous collection was moved to ${aside} and can be put back from Settings.`,
      );
    }
    // Nothing has been replaced yet: undo the renames, drop what was staged,
    // and leave no empty dated folder behind.
    for (const { from, to } of moved.reverse()) await fsp.rename(to, from).catch(() => undefined);
    await fsp.rm(staged, { force: true }).catch(() => undefined);
    await fsp.rmdir(aside).catch(() => undefined);
    throw new Error(`The restore failed before anything was replaced: ${reason}. Your collection is untouched.`);
  } finally {
    deps.unlockDatabase();
  }

  return { movedAsideTo: aside };
}
