import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lockDatabase, openDatabase, setDb, unlockDatabase } from "@/lib/db";
import { createItem, listItems } from "@/lib/items";
import { buildBackup, putBack, replacedCollections, restoreBackup } from "@/lib/backup";
import { flushCollection } from "@/lib/markdown/mirror";
import { zipStream } from "@collectcollect/core/zip";
import { clutchCase, redline } from "./helpers";

/**
 * The backup is the database plus the plain-text copy; the restore swaps it
 * in without ever leaving the app with no inventory at all.
 *
 * Each test opens a real file rather than an in-memory database, because
 * the thing under test is what happens to the file.
 */

/** A data directory holding an item, opened as the live database. */
function inventory(): string {
  const dir = process.env.SKINS_DATA_DIR!;
  fs.mkdirSync(dir, { recursive: true });
  setDb(openDatabase(path.join(dir, "collectcollect-skins.db")));
  createItem(redline({ purchasePrice: 42 }));
  return dir;
}

async function archiveOf(): Promise<Uint8Array> {
  const { stream } = await buildBackup();
  const parts: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) parts.push(chunk);
  return new Uint8Array(Buffer.concat(parts));
}

async function zipOf(entries: Array<[string, Uint8Array]>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of zipStream(entries.map(([name, body]) => ({ name, size: body.length, chunks: () => [body] })))) parts.push(c);
  return new Uint8Array(Buffer.concat(parts));
}

afterEach(() => setDb(undefined));

describe("the archive", () => {
  it("holds a working database copy and the plain-text inventory", async () => {
    const dir = inventory();
    flushCollection();
    const { filename, stream } = await buildBackup();
    expect(filename).toMatch(/^collectcollect-skins-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    const parts: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) parts.push(chunk);
    const file = path.join(os.tmpdir(), `skins-backup-${process.pid}.zip`);
    fs.writeFileSync(file, Buffer.concat(parts));

    expect(execFileSync("unzip", ["-t", file]).toString()).toMatch(/No errors detected/);
    const out = path.join(dir, "out");
    execFileSync("unzip", ["-q", file, "-d", out]);
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).app).toBe("collectcollect-skins");
    expect(fs.readdirSync(path.join(out, "collection", "items"))).toHaveLength(1);
    const copy = openDatabase(path.join(out, "collectcollect-skins.db"));
    expect((copy.prepare("SELECT market_hash_name FROM items").all() as Array<{ market_hash_name: string }>)[0]?.market_hash_name).toBe(
      "AK-47 | Redline (Field-Tested)",
    );
    copy.close();
    fs.rmSync(file, { force: true });
  });
});

describe("restore", () => {
  it("round-trips an inventory and keeps the replaced one", async () => {
    const dir = inventory();
    const archive = await archiveOf();
    createItem(clutchCase({ quantity: 3 }));
    fs.writeFileSync(path.join(dir, "collectcollect-skins.db-journal"), Buffer.from([7]));
    expect(listItems()).toHaveLength(2);

    const result = await restoreBackup(archive);
    expect(result.items).toBe(1);
    expect(listItems().map((i) => i.marketHashName)).toEqual(["AK-47 | Redline (Field-Tested)"]);
    // Nothing deleted: the replaced inventory, its write-ahead sibling and its
    // plain-text copy are all in the dated folder.
    const aside = fs.readdirSync(result.movedAsideTo);
    expect(aside).toContain("collectcollect-skins.db");
    expect(aside).toContain("collectcollect-skins.db-journal");
    expect(fs.readdirSync(path.join(result.movedAsideTo, "collection", "items"))).toHaveLength(2);
    expect(fs.existsSync(path.join(dir, "collectcollect-skins.db-journal"))).toBe(false);
    // The live plain-text copy describes what was restored.
    expect(fs.readdirSync(path.join(dir, "collection", "items"))).toHaveLength(1);
  });

  it("refuses an archive that is not one of its own backups, and leaves the inventory alone", async () => {
    const dir = inventory();
    await expect(restoreBackup(await zipOf([["notes.txt", new Uint8Array([1])]]))).rejects.toThrow(/did not write/);
    await expect(restoreBackup(await zipOf([["manifest.json", new Uint8Array([1])]]))).rejects.toThrow(/no collectcollect-skins.db/);
    // The card app's backup is the likeliest wrong file, and says so by name.
    await expect(restoreBackup(await zipOf([["collectcollect.db", new Uint8Array([1])]]))).rejects.toThrow(/card app/);
    await expect(restoreBackup(await zipOf([["uploads/a.jpg", new Uint8Array([1])]]))).rejects.toThrow(/card app/);
    await expect(restoreBackup(await zipOf([["../escape.db", new Uint8Array([1])]]))).rejects.toThrow(/unsafe path/);
    await expect(restoreBackup(await zipOf([["collectcollect-skins.db", new TextEncoder().encode("not a database")]]))).rejects.toThrow(
      /could not be opened/,
    );
    expect(listItems()).toHaveLength(1);
    expect(fs.readdirSync(dir).filter((n) => n.startsWith("replaced-"))).toEqual([]);
  });

  it("turns a second restore away while one is under way", async () => {
    inventory();
    const archive = await archiveOf();
    expect(lockDatabase("test lock")).toBe(true);
    await expect(restoreBackup(archive)).rejects.toThrow(/already in progress/);
    unlockDatabase();
    expect((await restoreBackup(archive)).items).toBe(1);
  });

  it("can be undone from the list of what it replaced", async () => {
    const dir = inventory();
    const archive = await archiveOf();
    createItem(clutchCase({ quantity: 3 }));
    const restored = await restoreBackup(archive);
    expect(listItems()).toHaveLength(1);

    const listed = replacedCollections();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: path.basename(restored.movedAsideTo), items: 2 });

    const back = await putBack(path.basename(restored.movedAsideTo));
    expect(back.items).toBe(2);
    expect(listItems()).toHaveLength(2);
    expect(fs.existsSync(restored.movedAsideTo)).toBe(false);
    expect(replacedCollections().map((r) => r.name)).toEqual([path.basename(back.movedAsideTo)]);
    expect(fs.readdirSync(path.join(dir, "collection", "items"))).toHaveLength(2);

    for (const bad of ["../elsewhere", "replaced-by-hand", "", "replaced-2099-01-01T00-00-00-000Z"]) {
      await expect(putBack(bad), bad).rejects.toThrow(/not one of the inventories/);
    }
  });

  it("leaves the inventory untouched when the swap cannot start", async () => {
    const dir = inventory();
    const archive = await archiveOf();
    createItem(clutchCase({ quantity: 3 }));
    fs.mkdirSync(path.join(dir, "collectcollect-skins.db.restoring"));
    await expect(restoreBackup(archive)).rejects.toThrow(/before anything was replaced/);
    expect(listItems()).toHaveLength(2);
    expect(fs.readdirSync(dir).filter((n) => n.startsWith("replaced-"))).toEqual([]);
  });
});
