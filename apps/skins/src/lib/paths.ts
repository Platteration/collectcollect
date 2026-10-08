import fs from "node:fs";
import path from "node:path";

/**
 * Where this app keeps everything, resolved without touching the database.
 * The proxy imports this for the session file; the database module imports it
 * for the database file; neither drags the other in.
 */
/** The file that marks a directory as holding this app's inventory. */
export const DB_FILE = "collectcollect-skins.db";

/**
 * Where the inventory lives.
 *
 * `SKINS_DATA_DIR` rather than `DATA_DIR`: the card app and this one are meant
 * to be able to run side by side from one shell or one .env file, and a shared
 * variable would quietly point both at the same folder. Nothing about the two
 * collections is shared — not the database, not the directory, not the
 * password.
 */
export function dataDir(): string {
  const dir = process.env.SKINS_DATA_DIR ? path.resolve(process.env.SKINS_DATA_DIR) : defaultDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let strayLookup = false;

/**
 * `data` beside the working directory — and, when that holds no inventory, a
 * look around for one that does.
 *
 * This app has never moved, so unlike the card app it does not switch to an
 * inventory it finds elsewhere: the likeliest way one ends up above or beside
 * here is a server started from the wrong directory, and silently adopting it
 * would hide that. It is named once, so that starting against an empty folder
 * while a full one sits a level up is at least not silent.
 */
function defaultDataDir(): string {
  const here = path.resolve(process.cwd(), "data");
  if (!strayLookup && !fs.existsSync(path.join(here, DB_FILE))) {
    strayLookup = true;
    const stray = findStrayInventory();
    if (stray) {
      console.warn(
        `[collectcollect-skins] Using ${here}, which holds no inventory, while ${stray} holds one. Set SKINS_DATA_DIR to point at it if that is yours.`,
      );
    }
  }
  return here;
}

function findStrayInventory(): string | null {
  let at = process.cwd();
  for (let up = 0; up < 3; up++) {
    const parent = path.dirname(at);
    if (parent === at) break;
    at = parent;
    for (const candidate of [path.join(at, "data"), path.join(at, "apps", "skins", "data")]) {
      if (fs.existsSync(path.join(candidate, DB_FILE))) return candidate;
    }
  }
  return null;
}

/** Tests only: look for a stray inventory again. */
export function resetDataDirLookup(): void {
  strayLookup = false;
}

