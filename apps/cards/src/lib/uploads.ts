import fsp from "node:fs/promises";
import path from "node:path";
import { databaseExists, getDb, uploadsDir } from "./db";
import { deleteUpload, isValidUploadName } from "./images";
import { BusyError } from "@collectcollect/core/gate";
import { archiveGate } from "./storage";

/**
 * How long a photo nobody has claimed is kept. An upload exists before the card
 * that will point at it does — the add screen posts the photo first and saves
 * the card afterwards, and someone may leave that half-finished over lunch — so
 * only files older than this are candidates.
 */
export const ORPHAN_GRACE_MS = 24 * 3600_000;

/**
 * Every upload a row still names: a card's photo, and every photo a scan draft
 * holds, whatever state the draft is in — a draft is a receipt the scan screen
 * reads back. Null when a draft's list cannot be read, because then nothing can
 * be said to be unclaimed.
 */
function referencedUploads(): Set<string> | null {
  const db = getDb();
  const names = new Set(
    (db.prepare("SELECT DISTINCT image_path AS name FROM cards WHERE image_path IS NOT NULL").all() as Array<{ name: string }>).map((r) => r.name),
  );
  const drafts = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scan_drafts'").get()
    ? (db.prepare("SELECT uploads FROM scan_drafts").all() as Array<{ uploads: string }>)
    : [];
  for (const { uploads } of drafts) {
    let list: unknown;
    try {
      list = JSON.parse(uploads);
    } catch {
      return null;
    }
    if (!Array.isArray(list)) return null;
    for (const name of list) if (typeof name === "string") names.add(name);
  }
  return names;
}

/**
 * Delete uploaded photos that no row points at.
 *
 * A card stores one photo, but the add screen writes a file for every photo it
 * is given — the back, the slab label, the frame that was re-taken — and
 * nothing else removes those, while every backup archives whatever is in the
 * uploads directory. Without a sweep the data directory, and every backup taken
 * from it, grows for good.
 *
 * It runs with the archive gate held, so it never deletes under a backup that
 * is copying the directory or a restore that is replacing it; a sweep that
 * finds one running waits for the next day. Anything this app did not write is
 * left alone: it is not the app's to delete.
 */
export async function sweepOrphanedUploads(opts: { now?: number; graceMs?: number } = {}): Promise<{ removed: number; bytes: number }> {
  const { now = Date.now(), graceMs = ORPHAN_GRACE_MS } = opts;
  // Looking must not create a collection where there is none.
  if (!databaseExists()) return { removed: 0, bytes: 0 };
  return archiveGate.run(async () => {
    const dir = uploadsDir();
    const names = await fsp.readdir(dir).catch(() => [] as string[]);
    const referenced = referencedUploads();
    if (!referenced) return { removed: 0, bytes: 0 };
    let removed = 0;
    let bytes = 0;
    for (const name of names) {
      if (!isValidUploadName(name) || referenced.has(name)) continue;
      try {
        const stat = await fsp.stat(path.join(dir, name));
        if (now - stat.mtimeMs < graceMs) continue;
        await deleteUpload(name);
        removed++;
        bytes += stat.size;
      } catch {
        /* already gone, or being written right now */
      }
    }
    return { removed, bytes };
  });
}

const globalForSweeper = globalThis as unknown as { __collectcollectSweeper?: NodeJS.Timeout };

/**
 * Once a day, starting a few minutes after boot (not at boot: a restore may
 * still be holding the database). One per process, like the price scheduler.
 * What it removed is said in the log, since it deletes files from the owner's
 * data directory; a day it removes nothing it says nothing.
 */
export function startUploadSweeper(): void {
  if (globalForSweeper.__collectcollectSweeper) return;
  const tick = async () => {
    try {
      const { removed, bytes } = await sweepOrphanedUploads();
      if (removed) console.warn(`[uploads] removed ${removed} photo${removed === 1 ? "" : "s"} no card or scan points at (${Math.round(bytes / 1024)} KB)`);
    } catch (e) {
      // A backup or restore holding the gate is the expected reason; anything else is worth reading.
      if (!(e instanceof BusyError)) console.error("[uploads] sweep failed", e);
    }
  };
  setTimeout(tick, 5 * 60_000).unref();
  globalForSweeper.__collectcollectSweeper = setInterval(tick, 24 * 3600_000);
  globalForSweeper.__collectcollectSweeper.unref();
}
