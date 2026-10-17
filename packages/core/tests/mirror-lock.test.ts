import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { widgetEngine } from "./widgets";

/**
 * The plain-text index is rewritten on a timer after an item changes, and
 * writing it makes the collection folder it writes into. A restore moves that
 * folder aside and rebuilds it, holding the database lock while it does; an
 * index written in the middle made a folder of its own there. (In the card
 * and skins apps, whose restore then moves a restored folder into place, the
 * move failed with ENOTEMPTY; their tests/restore-race.test.ts drive that.)
 */
afterEach(() => {
  vi.useRealTimers();
});

describe("the index timer while a restore holds the database", () => {
  it("writes nothing until the restore lets go, and then writes the index", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const engine = widgetEngine();
    engine.repo.createItem({ name: "Gizmo" });
    const folder = engine.mirror.collectionDir();
    expect(fs.existsSync(folder)).toBe(true);

    // As a restore does: take the lock, and move the folder out of the way.
    expect(engine.db.lockDatabase("A restore is in progress")).toBe(true);
    const aside = `${folder}-aside`;
    fs.renameSync(folder, aside);
    vi.advanceTimersByTime(5_000);
    expect(fs.existsSync(folder)).toBe(false);

    // Put back, and let go: the index the timer held back is written now.
    fs.renameSync(aside, folder);
    engine.db.unlockDatabase();
    vi.advanceTimersByTime(1_000);
    expect(fs.readFileSync(path.join(folder, "index.md"), "utf8")).toContain("Gizmo");
  });
});
