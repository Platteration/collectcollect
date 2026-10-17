import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, openDatabase, setDb, unlockDatabase } from "@/lib/db";
import { createItem, listItems } from "@/lib/items";
import { buildBackup, putBack, restoreBackup } from "@/lib/backup";
import { collectionDir } from "@/lib/markdown/mirror";
import { clutchCase, redline } from "./helpers";

/**
 * A restore moves the live collection folder aside and then moves the
 * restored one into its place, between two awaits. The plain-text index is
 * rewritten on a timer after an item changes, and writing it makes the folder
 * it writes into. A timer that fired between the two moves made a new folder
 * where the restored one was to go, and the second move failed with ENOTEMPTY
 * (seen in the card app's browser suite; this app's restore is the same).
 * Here the timer is made to fire at that moment.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  closeDatabase();
  unlockDatabase();
});

function inventory(): string {
  const dir = process.env.SKINS_DATA_DIR!;
  fs.mkdirSync(dir, { recursive: true });
  setDb(openDatabase(path.join(dir, "collectcollect-skins.db")));
  return dir;
}

async function archiveOf(): Promise<Uint8Array> {
  return new Uint8Array(await new Response((await buildBackup()).stream).arrayBuffer());
}

/** Fire the pending index timer the moment the live collection folder has been moved aside. */
function fireTheIndexMidSwap() {
  const rename = fsp.rename.bind(fsp);
  let fired = 0;
  vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
    await rename(from, to);
    const target = String(to);
    if (path.basename(target) === "collection" && path.basename(path.dirname(target)).startsWith("replaced-")) {
      vi.advanceTimersByTime(1_000);
      fired++;
    }
  });
  return () => fired;
}

describe("a restore while the plain-text index is due to be rewritten", () => {
  it("restores and puts back, and the index is written once each is done", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    inventory();
    createItem(redline({ purchasePrice: 42 }));
    const archive = await archiveOf();
    createItem(clutchCase());
    const fired = fireTheIndexMidSwap();

    const restored = await restoreBackup(archive);
    expect(fired()).toBe(1);
    expect(listItems()).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(fs.existsSync(path.join(collectionDir(), "index.md"))).toBe(true);

    createItem(clutchCase());
    const back = await putBack(path.basename(restored.movedAsideTo));
    expect(fired()).toBe(2);
    expect(back.items).toBe(2);
  });
});
