import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, openDatabase, setDb } from "@/lib/db";
import { createCard, listCards } from "@/lib/cards";
import { buildBackup, putBack, restoreBackup } from "@/lib/backup";
import { collectionDir, flushCollection } from "@/lib/markdown/mirror";

/**
 * A restore moves the live collection folder aside and then moves the
 * restored one into its place, between two awaits. The plain-text index is
 * rewritten on a timer, 750 ms after a card changes, and writing it makes the
 * folder it writes into. A timer that fired between the two moves (a card
 * saved just before the restore was asked for, on a loaded machine) made a new
 * collection folder where the restored one was to go, and the second move
 * failed with ENOTEMPTY: "a restore can be undone from Settings" failed so,
 * once, in the browser suite. Here the timer is made to fire at that moment.
 */
const temporary: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  closeDatabase();
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function collection() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-restore-race-"));
  temporary.push(dir);
  process.env.DATA_DIR = dir;
  setDb(openDatabase(path.join(dir, "collectcollect.db")));
  fs.mkdirSync(path.join(dir, "uploads"));
  return dir;
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
  it("restores, and the index is written once the restore is done", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    collection();
    createCard({ game: "pokemon", name: "In the backup" });
    flushCollection();
    const archive = new Uint8Array(await new Response((await buildBackup()).stream).arrayBuffer());
    // Saved after the backup: its file is written now, its index line 750 ms from now.
    createCard({ game: "pokemon", name: "Saved just before the restore" });
    const fired = fireTheIndexMidSwap();

    const restored = await restoreBackup(archive);
    expect(fired()).toBe(1);
    expect(restored.cards).toBe(1);
    expect(listCards().map((card) => card.name)).toEqual(["In the backup"]);
    // The restored folder is the one in place, and the replaced one is whole beside it.
    expect(fs.readdirSync(path.join(collectionDir(), "cards")).some((file) => file.includes("In-the-backup") || file.toLowerCase().includes("in-the-backup"))).toBe(true);
    expect(fs.readdirSync(path.join(restored.movedAsideTo, "collection", "cards")).length).toBe(2);
    // The index the timer held back is written once the restore has finished.
    vi.advanceTimersByTime(1_000);
    expect(fs.readFileSync(path.join(collectionDir(), "index.md"), "utf8")).toContain("In the backup");
    expect(fs.readFileSync(path.join(collectionDir(), "index.md"), "utf8")).not.toContain("Saved just before the restore");
  });

  it("puts the replaced collection back the same way", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    collection();
    createCard({ game: "pokemon", name: "In the backup" });
    const archive = new Uint8Array(await new Response((await buildBackup()).stream).arrayBuffer());
    createCard({ game: "pokemon", name: "Replaced by the restore" });
    const restored = await restoreBackup(archive);
    createCard({ game: "pokemon", name: "Saved after the restore" });
    const fired = fireTheIndexMidSwap();

    const back = await putBack(path.basename(restored.movedAsideTo));
    expect(fired()).toBe(1);
    expect(back.cards).toBe(2);
    expect(listCards().map((card) => card.name).sort()).toEqual(["In the backup", "Replaced by the restore"]);
  });
});
