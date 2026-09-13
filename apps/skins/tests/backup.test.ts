import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lockDatabase, openDatabase, setDb, unlockDatabase } from "@/lib/db";
import { createItem, listItems } from "@/lib/items";
import { archiveGate, buildBackup, putBack, replacedCollections, restoreBackup, restoreThrottle } from "@/lib/backup";
import Database from "better-sqlite3";
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
    // A manifest naming the other app is refused before anything else is read.
    const cardsManifest = new TextEncoder().encode(JSON.stringify({ app: "collectcollect", format: 1 }));
    await expect(restoreBackup(await zipOf([["manifest.json", cardsManifest]]))).rejects.toThrow(/backup of the card app/);
    // A real SQLite file that is not an inventory used to be "opened" by
    // creating the tables in it, and reported as an empty inventory.
    const strangerFile = path.join(dir, "stranger.sqlite");
    const stranger = new Database(strangerFile);
    stranger.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
    stranger.close();
    await expect(restoreBackup(await zipOf([["collectcollect-skins.db", new Uint8Array(fs.readFileSync(strangerFile))]]))).rejects.toThrow(
      /not an inventory/,
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

  it("turns a restore away while a backup copy is being taken, and the other way round", async () => {
    const dir = inventory();
    const archive = await archiveOf();
    // Something holds the gate — a backup copying the database — for as long
    // as this promise is open.
    let release: () => void = () => {};
    const holding = archiveGate.run(() => new Promise<void>((resolve) => (release = resolve)));
    await expect(restoreBackup(archive)).rejects.toThrow(/already running/);
    await expect(buildBackup()).rejects.toThrow(/already running/);
    expect(fs.readdirSync(dir).filter((n) => n.startsWith("replaced-"))).toEqual([]);
    release();
    await holding;
    expect((await restoreBackup(archive)).items).toBe(1);
  });

  it("throttles putting a replaced inventory back as it does a restore", async () => {
    inventory();
    restoreThrottle.reset();
    const { POST } = await import("@/app/api/backup/replaced/route");
    const ask = () => POST(new Request("http://localhost/api/backup/replaced", { method: "POST", body: JSON.stringify({ name: "replaced-by-hand" }) }));
    for (let i = 0; i < 6; i++) expect((await ask()).status).toBe(400);
    const seventh = await ask();
    expect(seventh.status).toBe(429);
    expect(seventh.headers.get("Retry-After")).toBeTruthy();
    restoreThrottle.reset();
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

describe("an older database with duplicate asset ids", () => {
  it("keeps the id on the newest row, clears the others, and then enforces the index", () => {
    const dir = process.env.SKINS_DATA_DIR!;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "collectcollect-skins.db");
    // A database from before the index existed: same tables, no index, and
    // two rows carrying one asset id.
    const before = openDatabase(file);
    before.exec("DROP INDEX idx_items_asset");
    const now = new Date().toISOString();
    const insert = before.prepare(
      "INSERT INTO items (market_hash_name, category, stackable, quantity, asset_id, created_at, updated_at) VALUES (?, 'case', 1, 1, ?, ?, ?)",
    );
    insert.run("Clutch Case", "111", now, now);
    insert.run("Clutch Case", "111", now, now);
    insert.run("Chroma Case", "222", now, now);
    before.close();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const after = openDatabase(file);
    setDb(after);
    expect(after.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_asset'").get()).toBeTruthy();
    expect(after.prepare("SELECT id, asset_id AS assetId FROM items ORDER BY id").all()).toEqual([
      { id: 1, assetId: null },
      { id: 2, assetId: "111" },
      { id: 3, assetId: "222" },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Asset id 111 was on items 1, 2; item 2 keeps it/));
    // From here on a duplicate is refused, as it always was on a new database.
    expect(() => after.prepare("UPDATE items SET asset_id = '222' WHERE id = 1").run()).toThrow(/UNIQUE/);
    warn.mockRestore();
  });
});
