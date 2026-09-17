import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "@collectcollect/core/auth";
import { createAuthRoutes } from "@collectcollect/core/auth-route";
import { createSessionStore } from "@collectcollect/core/sessions";
import { BodyLimitError, readBodyLimited, readFormDataLimited } from "@collectcollect/core/http";
import { createStorageLock } from "@collectcollect/core/storage";
import { readRecoveryConflicts, recoverCollectionSwap } from "@collectcollect/core/collection-swap";
import { readZip, zipStream } from "@collectcollect/core/zip";
import { prepareDatabase } from "@collectcollect/core/restore-validation";
import { closeDatabase, getDb, openDatabase, setDb } from "@/lib/db";
import { createCard, listCards } from "@/lib/cards";
import { backupSummary, buildBackup, putBack, restoreBackup } from "@/lib/backup";
import { deleteUpload } from "@/lib/images";

const temporary: string[] = [];
const temp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-reliable-")); temporary.push(dir); return dir; };
afterEach(() => {
  closeDatabase();
  vi.restoreAllMocks();
  delete process.env.RELIABILITY_PASSWORD;
  delete process.env.RELIABILITY_SECRET;
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function authFixture() {
  process.env.RELIABILITY_PASSWORD = "test-password";
  return createAuth({ cookie: "test_session", passwordEnv: "RELIABILITY_PASSWORD", secretEnv: "RELIABILITY_SECRET", secretPrefix: "cards:" });
}

describe("authentication regressions", () => {
  it("invalidates explicit-secret sessions on password rotation and separates apps", async () => {
    const auth = authFixture();
    process.env.RELIABILITY_SECRET = "a-separate-signing-secret";
    const token = await auth.createToken();
    const otherApp = createAuth({ cookie: "other", passwordEnv: "RELIABILITY_PASSWORD", secretEnv: "RELIABILITY_SECRET", secretPrefix: "skins:" });
    expect(await otherApp.verifyToken(token)).toBe(false);
    process.env.RELIABILITY_PASSWORD = "new-password";
    expect(await auth.verifyToken(token)).toBe(false);
  });

  it("reserves every concurrent attempt before password verification", async () => {
    const { POST } = createAuthRoutes(authFixture());
    const attempt = () => POST(new Request("http://localhost/api/auth", { method: "POST", body: JSON.stringify({ password: "wrong" }) }));
    const responses = await Promise.all(Array.from({ length: 20 }, attempt));
    expect(responses.filter((response) => response.status === 401)).toHaveLength(8);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(12);
    expect((await attempt()).status).toBe(429);
  });

  it("does not write forged or malformed logout cookies and preserves revocation at capacity", async () => {
    const auth = authFixture();
    const store = createSessionStore(path.join(temp(), "sessions.json"));
    const { DELETE } = createAuthRoutes(auth, { sessions: store });
    const token = await auth.createToken();
    const forged = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    await DELETE(new Request("http://localhost/api/auth", { method: "DELETE", headers: { cookie: `test_session=${forged}` } }));
    expect(store.revoked().ids).toEqual([]);
    await DELETE(new Request("http://localhost/api/auth", { method: "DELETE", headers: { cookie: "test_session=%zz" } }));
    await DELETE(new Request("http://localhost/api/auth", { method: "DELETE", headers: { cookie: `test_session=${token}` } }));
    const future = Date.now() + 86400_000;
    for (let n = 0; n < 201; n++) store.revoke(`session-${n}`, future);
    expect(await auth.verifyToken(token, Date.now(), store.revoked())).toBe(false);
  });
});

describe("actual request limits", () => {
  it("cancels an oversized chunked body with no Content-Length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)); }, cancel });
    const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readBodyLimited(request, 10)).rejects.toBeInstanceOf(BodyLimitError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("counts extra multipart fields and still parses an accepted upload", async () => {
    const form = new FormData(); form.set("unrelated", "x".repeat(1024)); form.set("file", new File(["photo"], "p.jpg"));
    const incoming = new Request("http://localhost", { method: "POST", body: form });
    const raw = await incoming.arrayBuffer();
    await expect(readFormDataLimited(new Request("http://localhost", { method: "POST", body: raw, headers: incoming.headers }), 100)).rejects.toBeInstanceOf(BodyLimitError);
    const result = await readFormDataLimited(new Request("http://localhost", { method: "POST", body: form }), 4096);
    expect((result.get("file") as File).name).toBe("p.jpg");
  });
});

function collection() {
  const dir = temp(); process.env.DATA_DIR = dir;
  setDb(openDatabase(path.join(dir, "collectcollect.db")));
  fs.mkdirSync(path.join(dir, "uploads"));
  return dir;
}

async function zip(entries: Array<{ name: string; data: Uint8Array }>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of zipStream(entries.map(({ name, data }) => ({ name, size: data.length, chunks: () => [data] })))) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("collection snapshots and restore", () => {
  it("names an unresolved draft photo that is not there rather than refusing, and preserves goals in portable snapshot files", async () => {
    const dir = collection();
    const photo = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg";
    const draft = "aaaaaaaa-bbbb-4ccc-8ddd-111111111111";
    getDb().prepare("INSERT INTO scan_drafts(id,uploads,created_at,updated_at) VALUES(?,?,?,?)")
      .run(draft, JSON.stringify([photo]), new Date().toISOString(), new Date().toISOString());
    // A photo the draft is waiting on that the folder does not have is left
    // out and written down; it used to make the whole backup refuse.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const short = await buildBackup();
    expect(short.missingPhotos).toEqual([{ photo, cardId: null, cardName: null, draftId: draft }]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`scan draft ${draft}: ${photo}`)));
    const shortEntries = await readZip(new Uint8Array(await new Response(short.stream).arrayBuffer()), { maxTotalBytes: 50_000_000, maxEntries: 1000 });
    expect(shortEntries.some((entry) => entry.name === `uploads/${photo}`)).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(shortEntries.find((entry) => entry.name === "manifest.json")!.data)).missingPhotos).toEqual([{ photo, cardId: null, cardName: null, draftId: draft }]);
    fs.writeFileSync(path.join(dir, "uploads", photo), "draft-photo");
    const goalId = "aaaaaaaa-bbbb-4ccc-8ddd-222222222222";
    getDb().prepare("INSERT INTO collecting_goals(id,data,created_at,updated_at) VALUES(?,?,?,?)")
      .run(goalId, JSON.stringify({ name: "Portable goal", budget: 25 }), new Date().toISOString(), new Date().toISOString());
    const backup = await buildBackup();
    expect(backup.missingPhotos).toEqual([]);
    const entries = await readZip(new Uint8Array(await new Response(backup.stream).arrayBuffer()), { maxTotalBytes: 50_000_000, maxEntries: 1000 });
    expect(entries.some((entry) => entry.name === `uploads/${photo}`)).toBe(true);
    expect(new TextDecoder().decode(entries.find((entry) => entry.name === `collection/goals/goal-${goalId}.md`)!.data)).toContain("Portable goal");
  });

  it("backs up a collection whose photo file is gone, leaving that photo out and naming the card", async () => {
    const dir = collection();
    const gone = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg";
    const kept = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff.jpg";
    fs.writeFileSync(path.join(dir, "uploads", kept), "kept-photo");
    const lost = createCard({ game: "pokemon", name: "Lost its photo", imagePath: gone });
    createCard({ game: "pokemon", name: "Still has one", imagePath: kept });
    const missing = [{ photo: gone, cardId: lost.id, cardName: "Lost its photo", draftId: null }];
    // Settings says so before anyone presses the button.
    expect(backupSummary().missingPhotos).toEqual(missing);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backup = await buildBackup();
    expect(backup.missingPhotos).toEqual(missing);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Lost its photo \(card \d+\)/));
    const entries = await readZip(new Uint8Array(await new Response(backup.stream).arrayBuffer()), { maxTotalBytes: 50_000_000, maxEntries: 1000 });
    const names = entries.map((entry) => entry.name);
    expect(names).toContain(`uploads/${kept}`);
    expect(names).not.toContain(`uploads/${gone}`);
    const manifest = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "manifest.json")!.data));
    expect(manifest).toMatchObject({ photos: 1, missingPhotos: missing });
    // The backup copies the database; it does not edit it. What the card
    // pointed at is still recorded, for whoever finds the file later.
    const copy = path.join(temp(), "copy.db");
    fs.writeFileSync(copy, entries.find((entry) => entry.name === "collectcollect.db")!.data);
    const inside = new Database(copy, { readonly: true });
    expect(inside.prepare("SELECT image_path FROM cards WHERE id = ?").get(lost.id)).toEqual({ image_path: gone });
    inside.close();
  });

  it("restores a backup that names a photo it does not carry, clearing the reference and saying so", async () => {
    collection();
    createCard({ game: "pokemon", name: "Replaced by the restore" });
    const gone = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg";
    const kept = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff.jpg";
    const partly = "aaaaaaaa-bbbb-4ccc-8ddd-111111111111";
    const wholly = "aaaaaaaa-bbbb-4ccc-8ddd-222222222222";
    const file = path.join(temp(), "dangling.db");
    const source = openDatabase(file);
    const now = new Date().toISOString();
    source.prepare("INSERT INTO cards(game,name,image_path,created_at,updated_at) VALUES('pokemon','No photo any more',?,?,?)").run(gone, now, now);
    source.prepare("INSERT INTO cards(game,name,image_path,created_at,updated_at) VALUES('pokemon','Photo intact',?,?,?)").run(kept, now, now);
    source.prepare("INSERT INTO scan_drafts(id,uploads,created_at,updated_at) VALUES(?,?,?,?)").run(partly, JSON.stringify([gone, kept]), now, now);
    source.prepare("INSERT INTO scan_drafts(id,uploads,created_at,updated_at) VALUES(?,?,?,?)").run(wholly, JSON.stringify([gone]), now, now);
    source.close();
    const archive = await zip([{ name: "collectcollect.db", data: fs.readFileSync(file) }, { name: `uploads/${kept}`, data: Buffer.from("kept") }]);

    const result = await restoreBackup(archive);
    expect(result).toMatchObject({ cards: 2, photos: 1 });
    expect(result.missingPhotos).toEqual([
      { photo: gone, cardId: 1, cardName: "No photo any more", draftId: null },
      { photo: gone, cardId: null, cardName: null, draftId: partly },
      { photo: gone, cardId: null, cardName: null, draftId: wholly },
    ]);
    // The card is here without its photo, the draft keeps the upload that
    // exists, and the draft with nothing left is discarded rather than left
    // waiting on a file that will never come.
    expect(listCards().map((card) => [card.name, card.imagePath]).sort()).toEqual([["No photo any more", null], ["Photo intact", kept]]);
    expect(getDb().prepare("SELECT id, uploads, status FROM scan_drafts ORDER BY id").all()).toEqual([
      { id: partly, uploads: JSON.stringify([kept]), status: "queued" },
      { id: wholly, uploads: JSON.stringify([gone]), status: "discarded" },
    ]);
    // What was restored describes what is there, so the next backup has nothing to report.
    expect((await buildBackup()).missingPhotos).toEqual([]);
  });

  it("puts a replaced collection back even when one of its photo files has gone, and names the card", async () => {
    const dir = collection();
    const photo = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg";
    fs.writeFileSync(path.join(dir, "uploads", photo), "photo");
    const card = createCard({ game: "pokemon", name: "Had a photo", imagePath: photo });
    const archive = new Uint8Array(await new Response((await buildBackup()).stream).arrayBuffer());
    const restored = await restoreBackup(archive);
    // The photo vanishes from the folder that was moved aside.
    fs.rmSync(path.join(restored.movedAsideTo, "uploads", photo));
    const back = await putBack(path.basename(restored.movedAsideTo));
    expect(back).toMatchObject({ cards: 1, photos: 0, missingPhotos: [{ photo, cardId: card.id, cardName: "Had a photo", draftId: null }] });
    expect(listCards().map((c) => c.imagePath)).toEqual([null]);
  });
  it("streams a stable DB, photo and Markdown after live edits and photo removal", async () => {
    const dir = collection();
    const name = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg";
    fs.writeFileSync(path.join(dir, "uploads", name), "original-photo");
    createCard({ game: "pokemon", name: "Snapshot card", imagePath: name });
    const backup = await buildBackup();
    createCard({ game: "mtg", name: "New after snapshot" });
    await deleteUpload(name);
    const entries = await readZip(new Uint8Array(await new Response(backup.stream).arrayBuffer()), { maxTotalBytes: 50_000_000, maxEntries: 1000 });
    expect(new TextDecoder().decode(entries.find((entry) => entry.name === `uploads/${name}`)!.data)).toBe("original-photo");
    expect(entries.some((entry) => /new-after-snapshot/.test(entry.name))).toBe(false);
    expect(entries.some((entry) => /snapshot-card/.test(entry.name))).toBe(true);
  });

  it("rejects incompatible and future schemas before changing the live collection", async () => {
    collection(); createCard({ game: "pokemon", name: "Keep me" });
    const badPath = path.join(temp(), "bad.db");
    const bad = new Database(badPath); bad.exec("CREATE TABLE cards(id INTEGER)"); bad.close();
    await expect(restoreBackup(await zip([{ name: "collectcollect.db", data: fs.readFileSync(badPath) }]))).rejects.toThrow(/could not be opened/);
    expect(listCards().map((card) => card.name)).toEqual(["Keep me"]);
    const future = openDatabase(badPath + ".future"); future.pragma("user_version = 999"); future.close();
    await expect(restoreBackup(await zip([{ name: "collectcollect.db", data: fs.readFileSync(badPath + ".future") }]))).rejects.toThrow(/upgrade the app/);
    expect(listCards().map((card) => card.name)).toEqual(["Keep me"]);
  });

  it("judges a backup's schema against the version the app is given, not a number of its own", () => {
    const file = path.join(temp(), "versioned.db");
    const db = openDatabase(file); db.pragma("user_version = 2"); db.close();
    const readonly = (name: string) => new Database(name, { readonly: true, fileMustExist: true });
    expect(() => prepareDatabase(file, "cards", readonly, openDatabase, 1)).toThrow(/schema version 2/);
    // Opened plainly for the migrate step, since this build's own opener refuses a newer version too.
    expect(prepareDatabase(file, "cards", readonly, (name) => new Database(name), 2)).toBe(0);
  });

  it("validates goal documents before swapping the live collection", async () => {
    collection(); createCard({ game: "pokemon", name: "Keep me" });
    const badPath = path.join(temp(), "invalid-goal.db");
    const bad = openDatabase(badPath);
    bad.prepare("INSERT INTO collecting_goals(id,data,created_at,updated_at) VALUES(?,?,?,?)")
      .run("aaaaaaaa-bbbb-4ccc-8ddd-222222222222", "{", new Date().toISOString(), new Date().toISOString());
    bad.close();
    await expect(restoreBackup(await zip([{ name: "collectcollect.db", data: fs.readFileSync(badPath) }]))).rejects.toThrow();
    expect(listCards().map((card) => card.name)).toEqual(["Keep me"]);
  });

  it("rolls back the database when a later uploads rename fails", async () => {
    const dir = collection(); createCard({ game: "pokemon", name: "Before" });
    const backup = await buildBackup();
    const archive = new Uint8Array(await new Response(backup.stream).arrayBuffer());
    createCard({ game: "mtg", name: "Must survive" });
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      if (String(from) === path.join(dir, "uploads")) throw new Error("injected uploads rename failure");
      return rename(from, to);
    });
    await expect(restoreBackup(archive)).rejects.toThrow(/untouched/);
    expect(listCards().map((card) => card.name).sort()).toEqual(["Before", "Must survive"]);
    expect(fs.existsSync(path.join(dir, "collectcollect.db.restore-journal.json"))).toBe(false);
    expect(getDb().open).toBe(true);
  });

  it("recovers interrupted renames before opening a missing live database", () => {
    const dir = temp(); const live = path.join(dir, "collection.db");
    const aside = path.join(dir, "replaced-2026-01-01T00-00-00-000Z"); fs.mkdirSync(aside);
    const stage = path.join(dir, ".restore-test"); fs.mkdirSync(stage);
    const stagedDatabase = path.join(dir, ".collection.db.restore-test"); fs.writeFileSync(stagedDatabase, "new");
    fs.writeFileSync(path.join(aside, "collection.db"), "old");
    fs.writeFileSync(`${live}.restore-journal.json`, JSON.stringify({ version: 1, phase: "applying", stage, stagedDatabase, aside, moves: [{ from: live, to: path.join(aside, "collection.db") }] }));
    recoverCollectionSwap({ dataDir: dir, databaseFile: live, collectionDir: path.join(dir, "collection") });
    expect(fs.readFileSync(live, "utf8")).toBe("old");
    expect(fs.existsSync(`${live}.restore-journal.json`)).toBe(false);
  });

  it("can restart recovery after rollback completed but cleanup was interrupted", () => {
    const dir = temp(), live = path.join(dir, "collection.db");
    const aside = path.join(dir, "replaced-2026-01-01T00-00-00-000Z"); fs.mkdirSync(aside);
    const stage = path.join(dir, ".restore-test"); fs.mkdirSync(stage);
    const stagedDatabase = path.join(dir, ".collection.db.restore-test");
    fs.writeFileSync(live, "new"); fs.writeFileSync(path.join(aside, "collection.db"), "old");
    fs.writeFileSync(`${live}.restore-journal.json`, JSON.stringify({ version: 1, phase: "applying", stage, stagedDatabase, aside,
      moves: [{ from: live, to: path.join(aside, "collection.db") }, { from: stagedDatabase, to: live }] }));
    const remove = fs.rmSync.bind(fs);
    const mock = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (target === stage) throw new Error("process stopped during cleanup");
      return remove(target, options);
    });
    const paths = { dataDir: dir, databaseFile: live, collectionDir: path.join(dir, "collection") };
    expect(() => recoverCollectionSwap(paths)).toThrow(/cleanup/);
    expect(fs.readFileSync(live, "utf8")).toBe("old");
    mock.mockRestore();
    recoverCollectionSwap(paths);
    expect(fs.readFileSync(live, "utf8")).toBe("old");
    expect(fs.existsSync(`${live}.restore-journal.json`)).toBe(false);
  });

  it("leaves two copies of the photos in place, writes the pair down, and still finishes the rollback", () => {
    const dir = temp(), live = path.join(dir, "collection.db");
    const aside = path.join(dir, "replaced-2026-01-01T00-00-00-000Z"); fs.mkdirSync(aside);
    const stage = path.join(dir, ".restore-test"); fs.mkdirSync(stage);
    const stagedDatabase = path.join(dir, ".collection.db.restore-test");
    const uploads = path.join(dir, "uploads");
    fs.writeFileSync(live, "new"); fs.writeFileSync(path.join(aside, "collection.db"), "old");
    fs.mkdirSync(uploads); fs.writeFileSync(path.join(uploads, "a.jpg"), "a");
    fs.mkdirSync(path.join(aside, "uploads")); fs.writeFileSync(path.join(aside, "uploads", "b.jpg"), "b");
    fs.writeFileSync(`${live}.restore-journal.json`, JSON.stringify({ version: 1, phase: "applying", stage, stagedDatabase, aside,
      moves: [{ from: live, to: path.join(aside, "collection.db") }, { from: stagedDatabase, to: live }, { from: uploads, to: path.join(aside, "uploads") }] }));
    const paths = { dataDir: dir, databaseFile: live, uploadsDir: uploads, collectionDir: path.join(dir, "collection") };
    expect(recoverCollectionSwap(paths)).toEqual({ conflicts: [{ from: uploads, to: path.join(aside, "uploads") }] });
    // The database rolled back on its own; both photo folders are still there,
    // and so is the staging the incoming copy went through: nothing deleted.
    expect(fs.readFileSync(live, "utf8")).toBe("old");
    expect(fs.readdirSync(uploads)).toEqual(["a.jpg"]);
    expect(fs.readdirSync(path.join(aside, "uploads"))).toEqual(["b.jpg"]);
    expect(fs.readFileSync(stagedDatabase, "utf8")).toBe("new");
    expect(fs.existsSync(stage)).toBe(true);
    expect(fs.existsSync(`${live}.restore-journal.json`)).toBe(false);
    // The pair is written down where the next start and the Settings page find it, and stays until something settles it.
    expect(readRecoveryConflicts(live)).toMatchObject({ conflicts: [{ from: uploads, to: path.join(aside, "uploads") }], kept: [stage, stagedDatabase] });
    expect(recoverCollectionSwap(paths)).toEqual({ conflicts: [] });
    expect(readRecoveryConflicts(live)).not.toBeNull();
  });

  it("starts on the database at its own path when only the copy moved aside is doubled", () => {
    const dir = temp(), live = path.join(dir, "collection.db");
    const aside = path.join(dir, "replaced-2026-01-01T00-00-00-000Z"); fs.mkdirSync(aside);
    const stage = path.join(dir, ".restore-test"); fs.mkdirSync(stage);
    const stagedDatabase = path.join(dir, ".collection.db.restore-test"); fs.writeFileSync(stagedDatabase, "incoming");
    fs.writeFileSync(live, "mine"); fs.writeFileSync(path.join(aside, "collection.db"), "a copy of something");
    fs.writeFileSync(`${live}.restore-journal.json`, JSON.stringify({ version: 1, phase: "applying", stage, stagedDatabase, aside,
      moves: [{ from: live, to: path.join(aside, "collection.db") }] }));
    const paths = { dataDir: dir, databaseFile: live, collectionDir: path.join(dir, "collection") };
    // The restore never committed, so the collection is the one at its own
    // path; the doubled copy is left in the dated folder and written down.
    expect(recoverCollectionSwap(paths)).toEqual({ conflicts: [{ from: live, to: path.join(aside, "collection.db") }] });
    expect(fs.readFileSync(live, "utf8")).toBe("mine");
    expect(fs.readFileSync(path.join(aside, "collection.db"), "utf8")).toBe("a copy of something");
    expect(fs.existsSync(`${live}.restore-journal.json`)).toBe(false);
    expect(readRecoveryConflicts(live)?.conflicts).toEqual([{ from: live, to: path.join(aside, "collection.db") }]);
  });

  it("refuses to guess between two copies of the database itself, naming both and where the collection was", () => {
    const dir = temp(), live = path.join(dir, "collection.db");
    const aside = path.join(dir, "replaced-2026-01-01T00-00-00-000Z"); fs.mkdirSync(aside);
    const stage = path.join(dir, ".restore-test"); fs.mkdirSync(stage);
    const stagedDatabase = path.join(dir, ".collection.db.restore-test");
    fs.writeFileSync(stagedDatabase, "incoming"); fs.writeFileSync(live, "half of the incoming"); fs.writeFileSync(path.join(aside, "collection.db"), "old");
    const journal = JSON.stringify({ version: 1, phase: "applying", stage, stagedDatabase, aside,
      moves: [{ from: live, to: path.join(aside, "collection.db") }, { from: stagedDatabase, to: live }] });
    fs.writeFileSync(`${live}.restore-journal.json`, journal);
    const paths = { dataDir: dir, databaseFile: live, collectionDir: path.join(dir, "collection") };
    let message = "";
    try { recoverCollectionSwap(paths); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("two copies of the database");
    expect(message).toContain(stagedDatabase);
    expect(message).toContain(live);
    expect(message).toContain(aside);
    // Nothing moved, nothing deleted, and the journal is there for the next start.
    expect(fs.readFileSync(live, "utf8")).toBe("half of the incoming");
    expect(fs.readFileSync(stagedDatabase, "utf8")).toBe("incoming");
    expect(fs.readFileSync(path.join(aside, "collection.db"), "utf8")).toBe("old");
    expect(fs.readFileSync(`${live}.restore-journal.json`, "utf8")).toBe(journal);
    expect(readRecoveryConflicts(live)).toBeNull();
  });

  it("queues immutable-file mutations and continues after a failed operation", async () => {
    const lock = createStorageLock(); const events: number[] = [];
    let release!: () => void;
    const first = lock.run(async () => { await new Promise<void>((resolve) => { release = resolve; }); events.push(1); throw new Error("first failed"); });
    const failed = expect(first).rejects.toThrow("first failed");
    const second = lock.run(async () => { events.push(2); });
    await Promise.resolve(); release(); await failed; await second;
    expect(events).toEqual([1, 2]);
  });
});
