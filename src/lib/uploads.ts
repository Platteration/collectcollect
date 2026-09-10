import fsp from "node:fs/promises";
import path from "node:path";
import { getDb, uploadsDir } from "./db";
import { isValidUploadName } from "./images";

/**
 * How long a photo nobody has claimed is kept. An upload exists before the card
 * that will point at it does — the add and scan screens post the photo first and
 * save the card afterwards, and someone may leave that half-finished over lunch
 * — so only files older than this are candidates.
 */
export const ORPHAN_GRACE_MS = 24 * 3600_000;

/**
 * Delete uploaded photos that no card points at.
 *
 * A card stores one image_path, but the app writes a file for every shutter
 * press: the extra photos of a card's back and slab label, every scan that
 * ended in review or failure, every re-shot frame. Nothing else ever removes
 * those, and buildBackup archives whatever it finds in the uploads directory,
 * so without a sweep the data directory and every backup taken from it grow
 * monotonically.
 */
export async function sweepOrphanedUploads(
  opts: { now?: number; graceMs?: number } = {},
): Promise<{ removed: number; bytes: number }> {
  const { now = Date.now(), graceMs = ORPHAN_GRACE_MS } = opts;
  const dir = uploadsDir();
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  const referenced = new Set(
    (getDb().prepare("SELECT DISTINCT image_path AS name FROM cards WHERE image_path IS NOT NULL").all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );

  let removed = 0;
  let bytes = 0;
  for (const name of names) {
    // Anything this app did not write is left alone: it is not ours to delete.
    if (!isValidUploadName(name) || referenced.has(name)) continue;
    const full = path.join(dir, name);
    try {
      const stat = await fsp.stat(full);
      if (now - stat.mtimeMs < graceMs) continue;
      await fsp.unlink(full);
      removed++;
      bytes += stat.size;
    } catch {
      /* already gone, or being written right now */
    }
  }
  return { removed, bytes };
}
