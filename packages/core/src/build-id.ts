import fs from "node:fs";
import path from "node:path";

let fallback: string | null = null;

/**
 * Something that changes with every deploy, for the service worker's caches.
 *
 * A production server has `.next/BUILD_ID` in its working directory, whether
 * it was started with `next start` or from the standalone output, and that id
 * is new for every build. Development has no build, so it gets one id per
 * process, which errs on the side of re-precaching after a restart.
 */
export function buildVersion(dir = process.cwd()): string {
  try {
    const id = fs.readFileSync(/* turbopackIgnore: true */ path.join(dir, ".next", "BUILD_ID"), "utf8").trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) return id;
  } catch {
    // No build here: development, or a test.
  }
  return (fallback ??= `dev-${crypto.randomUUID().slice(0, 8)}`);
}
