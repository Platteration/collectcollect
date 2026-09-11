import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Write a file so that a reader only ever sees the old contents or the new.
 *
 * Written to a temporary name beside the target and renamed over it, which is
 * atomic on every filesystem the app runs on. The name carries the process id
 * and a random suffix: two processes, or two workers in one, writing the same
 * file at the same moment must not share a temporary file, or one renames the
 * other's half-written bytes into place. The data is flushed to disk before
 * the rename, so a power cut just after it cannot leave a file that exists but
 * is empty.
 */
export function writeFileAtomic(file: string, contents: string): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Whether a name is one of the temporary files this module leaves behind after a crash. */
export function isAtomicTempName(name: string): boolean {
  return name.endsWith(".tmp");
}
