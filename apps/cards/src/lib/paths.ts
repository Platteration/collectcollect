import fs from "node:fs";
import path from "node:path";

/**
 * Where this app keeps everything, resolved without touching the database.
 * The proxy imports this for the session file; the database module imports it
 * for the database file; neither drags the other in.
 */
/** The file that marks a directory as holding this app's collection. */
export const DB_FILE = "collectcollect.db";

/**
 * Where the collection lives.
 *
 * `DATA_DIR` wins. Otherwise it is `data` beside the working directory — but
 * this app used to run from the repository root and now runs from its own
 * workspace, so that default moved. Pointing a working install at an empty
 * folder and calling it an empty collection is the worst thing this app could
 * do, so when the default holds no database and an older one is found above it,
 * that one is used and says so out loud.
 */
export function dataDir(): string {
  const dir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : defaultDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let legacyLookup: { done: boolean; dir: string | null } = { done: false, dir: null };

function defaultDataDir(): string {
  const here = path.resolve(process.cwd(), "data");
  if (fs.existsSync(path.join(here, DB_FILE))) return here;
  return findLegacyDataDir() ?? here;
}

/**
 * A `data` directory holding a collection somewhere above the working
 * directory, from before this app moved into a workspace of its own. Looked for
 * once; a missing one is the normal case for a fresh install.
 */
function findLegacyDataDir(): string | null {
  if (legacyLookup.done) return legacyLookup.dir;
  legacyLookup = { done: true, dir: null };
  let at = process.cwd();
  for (let up = 0; up < 4; up++) {
    const parent = path.dirname(at);
    if (parent === at) break;
    at = parent;
    const candidate = path.join(at, "data");
    if (fs.existsSync(path.join(candidate, DB_FILE))) {
      console.warn(
        `[collectcollect] Using the collection found at ${candidate}. Set DATA_DIR to choose a different one.`,
      );
      legacyLookup.dir = candidate;
      return candidate;
    }
  }
  return null;
}

/** Tests only: forget where the older collection was found. */
export function resetDataDirLookup(): void {
  legacyLookup = { done: false, dir: null };
}

export function uploadsDir(): string {
  const dir = path.join(dataDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

