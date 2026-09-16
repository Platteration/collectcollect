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
import { recoverCollectionSwap } from "@collectcollect/core/collection-swap";
import { readZip, zipStream } from "@collectcollect/core/zip";
import { closeDatabase, getDb, openDatabase, setDb } from "@/lib/db";
import { createCard, listCards } from "@/lib/cards";
import { buildBackup, restoreBackup } from "@/lib/backup";
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
  it("checks unresolved draft photos and preserves goals in portable snapshot files", async () => {
    const dir = collection();
    const photo = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg";
    getDb().prepare("INSERT INTO scan_drafts(id,uploads,created_at,updated_at) VALUES(?,?,?,?)")
      .run("aaaaaaaa-bbbb-4ccc-8ddd-111111111111", JSON.stringify([photo]), new Date().toISOString(), new Date().toISOString());
    await expect(buildBackup()).rejects.toThrow(/missing photo/);
    fs.writeFileSync(path.join(dir, "uploads", photo), "draft-photo");
    const goalId = "aaaaaaaa-bbbb-4ccc-8ddd-222222222222";
    getDb().prepare("INSERT INTO collecting_goals(id,data,created_at,updated_at) VALUES(?,?,?,?)")
      .run(goalId, JSON.stringify({ name: "Portable goal", budget: 25 }), new Date().toISOString(), new Date().toISOString());
    const backup = await buildBackup();
    const entries = await readZip(new Uint8Array(await new Response(backup.stream).arrayBuffer()), { maxTotalBytes: 50_000_000, maxEntries: 1000 });
    expect(entries.some((entry) => entry.name === `uploads/${photo}`)).toBe(true);
    expect(new TextDecoder().decode(entries.find((entry) => entry.name === `collection/goals/goal-${goalId}.md`)!.data)).toContain("Portable goal");
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
