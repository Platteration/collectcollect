import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { writeFileAtomic } from "./atomic-write";

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
 * Ordinary failures roll every resource back together. A persisted journal
 * lets startup finish that rollback after a crash, before any live connection
 * opens; a committed swap retains the previous collection in its dated folder.
 */

export interface SwapDeps {
  /** The directory the dated folders are made in. */
  dataDir(): string;
  /** The live database file, wherever it is. */
  databaseFile(): string;
  /** Canonical filename used inside replaced collections. */
  databaseName?: string;
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
  if (!fs.existsSync(/* turbopackIgnore: true */ dataDir)) return [];
  return fs
    .readdirSync(dataDir)
    .filter((name) => REPLACED_NAME.test(name) && fs.statSync(/* turbopackIgnore: true */ path.join(dataDir, name)).isDirectory())
    .sort()
    .reverse();
}

/** The path of a dated folder, or null when the name is not one this module wrote. */
export function replacedFolder(dataDir: string, name: string): string | null {
  return REPLACED_NAME.test(name) ? path.join(dataDir, name) : null;
}

export interface RecoveryPaths {
  dataDir: string;
  databaseFile: string;
  uploadsDir?: string;
  collectionDir: string;
}

interface Journal {
  version: 1;
  phase: "applying" | "committed";
  moves: Array<{ from: string; to: string }>;
  stage: string;
  stagedDatabase: string;
  aside: string;
}

/** Run before opening the live connection, including after an interrupted restore. */
export function recoverCollectionSwap(paths: RecoveryPaths): void {
  const file = `${paths.databaseFile}.restore-journal.json`;
  if (!fs.existsSync(/* turbopackIgnore: true */ file)) return;
  const journal = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, "utf8")) as Journal;
  const root = path.resolve(paths.dataDir);
  const live = path.resolve(paths.databaseFile);
  const inRoot = (candidate: string) => {
    const relative = path.relative(root, path.resolve(candidate));
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  const allowed = (candidate: string) => inRoot(candidate) ||
    candidate === live || candidate === `${live}-wal` || candidate === `${live}-shm` || candidate === `${live}-journal` ||
    (path.dirname(candidate) === path.dirname(live) && path.basename(candidate).startsWith(`.${path.basename(live)}.restore-`));
  if (journal.version !== 1 || !["applying", "committed"].includes(journal.phase) || !Array.isArray(journal.moves) ||
      !inRoot(journal.stage) || !inRoot(journal.aside) || !allowed(journal.stagedDatabase) ||
      journal.moves.some((move) => !allowed(move.from) || !allowed(move.to))) {
    throw new Error("The restore recovery journal is invalid; the collection was left untouched");
  }
  if (journal.phase === "applying") {
    while (journal.moves.length) {
      const { from, to } = journal.moves[journal.moves.length - 1]!;
      if (fs.existsSync(/* turbopackIgnore: true */ to)) {
        if (fs.existsSync(/* turbopackIgnore: true */ from)) throw new Error("Restore recovery found both copies; keep both and repair the journal before reopening");
        fs.renameSync(/* turbopackIgnore: true */ to, from);
      }
      // Recovery itself can stop. Persist its remaining work before restoring
      // an earlier resource into a path that a later rename also used.
      journal.moves.pop();
      writeFileAtomic(file, JSON.stringify(journal));
    }
    // An empty replaced directory is only a failed attempt, not a restore point.
    try { fs.rmdirSync(/* turbopackIgnore: true */ journal.aside); } catch { /* preserve anything unexpected */ }
  }
  fs.rmSync(/* turbopackIgnore: true */ journal.stage, { recursive: true, force: true });
  fs.rmSync(/* turbopackIgnore: true */ journal.stagedDatabase, { force: true });
  fs.rmSync(/* turbopackIgnore: true */ file);
}

export async function swapCollection(deps: SwapDeps, incoming: Incoming): Promise<SwapResult> {
  const root = path.resolve(deps.dataDir());
  const live = path.resolve(deps.databaseFile());
  const liveDir = path.dirname(live);
  // A rename across volumes cannot be rolled back as an atomic operation.
  if ((await fsp.stat(/* turbopackIgnore: true */ root)).dev !== (await fsp.stat(/* turbopackIgnore: true */ liveDir)).dev) {
    throw new Error("Online restore requires the database and data directory on the same filesystem. Stop the app and restore offline instead.");
  }
  if (!deps.lockDatabase("A restore is in progress; try again in a moment.")) throw new Error("A restore is already in progress");
  const token = crypto.randomUUID();
  const stage = path.join(root, `.restore-${token}`);
  const stagedDatabase = path.join(liveDir, `.${path.basename(live)}.restore-${token}`);
  let stamp = Date.now();
  let aside = path.join(root, replacedFolderName(new Date(stamp)));
  while (fs.existsSync(/* turbopackIgnore: true */ aside)) aside = path.join(root, replacedFolderName(new Date(++stamp)));
  const journalFile = `${live}.restore-journal.json`;
  const journal: Journal = { version: 1, phase: "applying", moves: [], stage, stagedDatabase, aside };
  const writeJournal = () => writeFileAtomic(journalFile, JSON.stringify(journal));
  const move = async (from: string, to: string) => {
    // Record intent before rename. Recovery distinguishes an unfinished rename
    // by the source still existing and the destination not existing.
    journal.moves.push({ from, to });
    writeJournal();
    await fsp.rename(/* turbopackIgnore: true */ from, to);
  };
  try {
    await fsp.mkdir(/* turbopackIgnore: true */ stage);
    // Allocate and copy everything before moving anything live aside.
    await fsp.copyFile(/* turbopackIgnore: true */ incoming.database.path, stagedDatabase);
    if (deps.uploadsDir) {
      const stagedUploads = path.join(stage, "uploads");
      await fsp.mkdir(/* turbopackIgnore: true */ stagedUploads);
      if (incoming.uploads && "dir" in incoming.uploads) {
        await fsp.cp(/* turbopackIgnore: true */ incoming.uploads.dir, stagedUploads, { recursive: true, force: false, errorOnExist: false });
      } else if (incoming.uploads) {
        for (const photo of incoming.uploads.photos) await fsp.writeFile(/* turbopackIgnore: true */ path.join(stagedUploads, photo.name), photo.data);
      }
    }
    if (incoming.collection && fs.existsSync(/* turbopackIgnore: true */ incoming.collection)) await fsp.cp(/* turbopackIgnore: true */ incoming.collection, path.join(stage, "collection"), { recursive: true });
    await fsp.mkdir(/* turbopackIgnore: true */ aside);
    deps.closeDatabase();
    writeJournal();
    const canonicalName = deps.databaseName ?? path.basename(live);
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      if (fs.existsSync(/* turbopackIgnore: true */ `${live}${suffix}`)) await move(`${live}${suffix}`, path.join(aside, `${canonicalName}${suffix}`));
    }
    await move(stagedDatabase, live);
    if (deps.uploadsDir) {
      const uploads = deps.uploadsDir();
      if (fs.existsSync(/* turbopackIgnore: true */ uploads)) await move(uploads, path.join(aside, "uploads"));
      await move(path.join(stage, "uploads"), uploads);
    }
    const collection = deps.collectionDir();
    if (fs.existsSync(/* turbopackIgnore: true */ collection)) await move(collection, path.join(aside, "collection"));
    if (fs.existsSync(/* turbopackIgnore: true */ path.join(stage, "collection"))) await move(path.join(stage, "collection"), collection);
    journal.phase = "committed";
    writeJournal();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (fs.existsSync(/* turbopackIgnore: true */ journalFile)) {
      try {
        recoverCollectionSwap({ dataDir: root, databaseFile: live, collectionDir: deps.collectionDir() });
      } catch (recoveryError) {
        // Keep the DB locked until a restart can complete recovery. No request
        // should accidentally create a new empty database in the meantime.
        throw new Error(`Restore recovery needs attention: ${recoveryError instanceof Error ? recoveryError.message : recoveryError}. Both copies and the recovery journal were preserved.`);
      }
    } else {
      await fsp.rm(/* turbopackIgnore: true */ stage, { recursive: true, force: true });
      await fsp.rm(/* turbopackIgnore: true */ stagedDatabase, { force: true });
      try { await fsp.rmdir(/* turbopackIgnore: true */ aside); } catch { /* not created yet */ }
    }
    deps.unlockDatabase();
    throw new Error(`The restore failed before anything was replaced permanently: ${reason}. Your collection is untouched.`);
  }
  // The committed marker makes post-commit cleanup safe to repeat after a crash.
  recoverCollectionSwap({ dataDir: root, databaseFile: live, collectionDir: deps.collectionDir() });
  deps.unlockDatabase();
  return { movedAsideTo: aside };
}
