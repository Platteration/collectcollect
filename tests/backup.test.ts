import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESTORE_MAX_BYTES, backupSummary, buildBackup, replacedCollections, restoreBackup } from "@/lib/backup";
import { createCard, findSimilar, listCards } from "@/lib/cards";
import { getDb, openDatabase, openLiveDatabase, openStagedDatabase, setDb } from "@/lib/db";
import { IMPORT_MAX_BYTES, MAX_REQUEST_BYTES, MAX_REQUEST_SIZE, UPLOAD_MAX_BYTES, UPLOAD_MAX_TOTAL_BYTES } from "@/lib/limits";
import { RESTORE_PER_HOUR, resetLimiters } from "@/lib/rate-limit";
import { zipStream } from "@/lib/zip";

let dir: string;
const previousDataDir = process.env.DATA_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-backup-"));
  process.env.DATA_DIR = dir;
  // A restore replaces the database file, so these need one on disk rather than
  // the in-memory connection the other suites use.
  setDb(openLiveDatabase(path.join(dir, "collectcollect.db")));
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what a restore left behind", () => {
  it("finds nothing in a data directory no restore has touched", () => {
    expect(replacedCollections()).toEqual({ folders: [], bytes: 0 });
    expect(backupSummary().replaced).toEqual({ folders: 0, bytes: 0 });
  });

  it("reports the folders and what they cost, so the space is not held invisibly", () => {
    for (const stamp of ["replaced-2026-01-01T00-00-00-000Z", "replaced-2026-02-02T00-00-00-000Z"]) {
      fs.mkdirSync(path.join(dir, stamp, "uploads"), { recursive: true });
      fs.writeFileSync(path.join(dir, stamp, "collectcollect.db"), "x".repeat(100));
      fs.writeFileSync(path.join(dir, stamp, "uploads", "photo.jpg"), "y".repeat(50));
    }
    // Anything else in the data directory is not a replaced collection.
    fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });

    const { folders, bytes } = replacedCollections();
    expect(folders).toHaveLength(2);
    expect(bytes).toBe(300);
    expect(backupSummary().replaced).toEqual({ folders: 2, bytes: 300 });
  });
});

/**
 * A restore is the one place this app takes a whole file someone else wrote and
 * installs it as its own state, and the only thing it used to ask of the
 * database inside was that `SELECT COUNT(*) FROM cards` ran — less than POST
 * /api/cards asks of a single card. Those rows are then rendered by every page
 * and parsed on the way out, so a 16 KB archive replaced the collection and
 * left the portfolio, the collection, the report, every card page and the cards
 * API all answering 500, with no way back through the app.
 */
describe("the database inside an archive", () => {
  const zip = async (entries: Array<{ name: string; body: Uint8Array }>): Promise<Uint8Array> => {
    const parts: Uint8Array[] = [];
    for await (const chunk of zipStream(entries.map((e) => ({ name: e.name, size: e.body.length, chunks: () => [e.body] })))) {
      parts.push(chunk);
    }
    return new Uint8Array(Buffer.concat(parts));
  };

  /** A database with the app's own schema and one row, doctored as asked. */
  const archiveWith = async (doctor?: (db: ReturnType<typeof openDatabase>) => void): Promise<Uint8Array> => {
    const file = path.join(dir, `staged-${Math.random().toString(16).slice(2)}.db`);
    const db = openDatabase(file);
    db.pragma("journal_mode = DELETE");
    db.prepare(
      `INSERT INTO cards (game, name, name_key, quantity, condition, grading_status, external_ids, manual_graded, created_at, updated_at)
       VALUES ('pokemon', 'Charizard', 'charizard', 1, 'NM', 'undecided', '{}', '{}', 't', 't')`,
    ).run();
    doctor?.(db);
    db.close();
    return zip([
      { name: "manifest.json", body: new TextEncoder().encode("{}") },
      { name: "collectcollect.db", body: new Uint8Array(fs.readFileSync(file)) },
    ]);
  };

  const restored = () => fs.readdirSync(dir).filter((name) => name.startsWith("replaced-"));

  it("restores when every row holds up", async () => {
    const result = await restoreBackup(await archiveWith());
    expect(result.cards).toBe(1);
    expect(restored()).toHaveLength(1);
    expect(listCards()[0]).toMatchObject({ game: "pokemon", name: "Charizard" });
  });

  it.each([
    ["a game no page can render", "UPDATE cards SET game = '__proto__'", /unknown game/],
    ["a condition that is not one", "UPDATE cards SET condition = 'constructor'", /unknown condition/],
    ["a grading status that is not one", "UPDATE cards SET grading_status = 'toString'", /unknown grading status/],
    ["a colour that is not a colour", "UPDATE cards SET accent_color = 'red; background:url(x)'", /accent colour/],
    ["a photo this app could not have stored", "UPDATE cards SET image_path = '../../etc/passwd'", /photo this app could not have stored/],
    ["a javascript: link", "UPDATE cards SET reference_image_url = 'javascript:alert(1)'", /reference image URL/],
    ["a column that is not JSON", "UPDATE cards SET manual_graded = '{'", /manual_graded column that is not JSON/],
    ["a price summary that is not JSON", "INSERT INTO price_snapshots (card_id, fetched_at, summary) VALUES (1, 't', '{')", /summary that is not JSON/],
    ["a checklist that is not a list", "INSERT INTO set_checklists (game, set_id, set_name, cards, fetched_at) VALUES ('pokemon','b','Base','{',  't')", /list of cards/],
    // The tables the first pass of this check never looked at. An alert's kind
    // keys both the label and the badge class on the page the alert has to be
    // dismissed from, so one bad row used to leave /alerts answering 500 for
    // good while every other page looked fine.
    ["an alert kind no page can render", "INSERT INTO alerts (kind, title, body, created_at) VALUES ('__proto__','t','b','t')", /unknown kind/],
    ["a submission status that is not one", "INSERT INTO submissions (name, company, status, created_at, updated_at) VALUES ('s','PSA','constructor','t','t')", /unknown status/],
    ["money that is not a number", "INSERT INTO sales (card_id, quantity, unit_price, fees, sold_at, created_at) VALUES (1, 1, 'lots', 0, 't', 't')", /unit_price that is not a number/],
    ["settings that are not settings", "INSERT INTO settings (key, value) VALUES ('settings', '\"not an object\"')", /does not hold a settings object/],
  ])("refuses %s, and leaves the collection where it was", async (_label, sql, message) => {
    createCard({ game: "mtg", name: "Ragavan" });
    const archive = await archiveWith((db) => db.prepare(sql).run());

    await expect(restoreBackup(archive)).rejects.toThrow(message);
    // Refused before anything live was touched: no replaced- folder, and the
    // collection is still the one that was there.
    expect(restored()).toEqual([]);
    expect(listCards()).toHaveLength(1);
    expect(listCards()[0].name).toBe("Ragavan");
  });

  it("still says plainly when the file is not a database at all", async () => {
    const archive = await zip([
      { name: "manifest.json", body: new TextEncoder().encode("{}") },
      { name: "collectcollect.db", body: new TextEncoder().encode("not a database") },
    ]);
    await expect(restoreBackup(archive)).rejects.toThrow(/could not be opened/);
    expect(restored()).toEqual([]);
  });
});

/**
 * A SQLite file is not only data: a trigger is code, and it runs whenever the
 * table it watches is written. Backfilling `name_key` on every database this app
 * opened meant running an UPDATE against the archive's own file before anything
 * had looked at it, which handed the archive's author a subroutine — measured at
 * 13 seconds of frozen server and 229 MB written from a 2.9 KB upload, with the
 * trigger then installed into the live collection, where it fired on every later
 * card edit. Two things keep it shut: the inspection cannot write, and a schema
 * carrying anything this app does not create is refused.
 */
describe("the schema inside an archive", () => {
  const zip = async (entries: Array<{ name: string; body: Uint8Array }>): Promise<Uint8Array> => {
    const parts: Uint8Array[] = [];
    for await (const chunk of zipStream(entries.map((e) => ({ name: e.name, size: e.body.length, chunks: () => [e.body] })))) {
      parts.push(chunk);
    }
    return new Uint8Array(Buffer.concat(parts));
  };

  const archiveWith = async (doctor?: (db: ReturnType<typeof openDatabase>) => void): Promise<Uint8Array> => {
    const file = path.join(dir, `staged-${Math.random().toString(16).slice(2)}.db`);
    const db = openDatabase(file);
    db.pragma("journal_mode = DELETE");
    db.prepare(
      `INSERT INTO cards (game, name, name_key, quantity, condition, grading_status, external_ids, manual_graded, created_at, updated_at)
       VALUES ('pokemon', 'Charizard', 'charizard', 1, 'NM', 'undecided', '{}', '{}', 't', 't')`,
    ).run();
    doctor?.(db);
    db.close();
    return zip([
      { name: "manifest.json", body: new TextEncoder().encode("{}") },
      { name: "collectcollect.db", body: new Uint8Array(fs.readFileSync(file)) },
    ]);
  };

  const restored = () => fs.readdirSync(dir).filter((name) => name.startsWith("replaced-"));

  it("cannot be written to while it is being inspected", () => {
    // The direct statement of it: whatever this app runs against a file someone
    // else wrote, it cannot write — and a write is what fires a trigger.
    const file = path.join(dir, "staged.db");
    openDatabase(file).close();
    const staged = openStagedDatabase(file);
    try {
      expect(staged.prepare("SELECT COUNT(*) AS n FROM cards").get()).toEqual({ n: 0 });
      expect(() => staged.exec("UPDATE cards SET name_key = lower(trim(name))")).toThrow(/readonly|read-only|query_only/i);
      expect(() => staged.exec("CREATE TABLE loot (x TEXT)")).toThrow(/readonly|read-only|query_only/i);
      expect(() => staged.exec("DELETE FROM cards")).toThrow(/readonly|read-only|query_only/i);
    } finally {
      staged.close();
    }
  });

  it.each([
    [
      "a trigger, which is code that runs on every later edit",
      "CREATE TRIGGER boom AFTER UPDATE ON cards BEGIN UPDATE cards SET notes = hex(randomblob(1024)); END",
      /trigger called "boom"/,
    ],
    ["a view standing in for a table the app reads", "CREATE VIEW sales_by_card AS SELECT * FROM cards", /view called "sales_by_card"/],
    ["a table this app never creates", "CREATE TABLE loot (secret TEXT)", /table called "loot"/],
    ["an index this app never creates", "CREATE INDEX idx_extra ON cards(notes)", /index called "idx_extra"/],
  ])("refuses an archive carrying %s", async (_label, sql, message) => {
    createCard({ game: "mtg", name: "Ragavan" });
    const archive = await archiveWith((db) => db.exec(sql));

    await expect(restoreBackup(archive)).rejects.toThrow(message);
    expect(restored()).toEqual([]);
    expect(listCards().map((c) => c.name)).toEqual(["Ragavan"]);
    // And nothing of it reached the live database, which is where a trigger
    // would have gone on firing long after the request was answered.
    const live = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','view') OR name IN ('loot','idx_extra')")
      .all() as Array<{ name: string }>;
    expect(live).toEqual([]);
  });

  it("refuses a table of ours whose columns are not ours", async () => {
    const archive = await archiveWith((db) => db.exec("ALTER TABLE cards DROP COLUMN notes"));
    await expect(restoreBackup(archive)).rejects.toThrow(/cards table has no notes column/);
    expect(restored()).toEqual([]);
  });

  it("still takes an older backup, which is missing what came later", async () => {
    // The columns and tables a later version added are allowed to be absent:
    // the live open puts them back. Refusing these would make the app unable to
    // restore its own backups, which is the failure this check must not cause.
    const archive = await archiveWith((db) => {
      db.exec("ALTER TABLE cards DROP COLUMN location");
      db.exec("DROP TABLE alerts");
      db.exec("UPDATE cards SET name_key = NULL");
    });
    const result = await restoreBackup(archive);
    expect(result.cards).toBe(1);
    expect(listCards()[0]).toMatchObject({ game: "pokemon", name: "Charizard", location: null });
    // Opened as the live database, so the rows it could not have written are
    // repaired: the normalised name is filled in and the card is findable.
    expect(findSimilar({ game: "pokemon", name: "  charizard " })).toHaveLength(1);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM alerts").get()).toEqual({ n: 0 });
  });
});

/**
 * A restore is the only way a collection comes back, and the limiter guarding it
 * used to be charged at the door: six 200-byte files that are not archives at
 * all shut the owner out of their own recovery path for an hour.
 */
describe("how often a restore may be attempted", () => {
  const post = async (body: Uint8Array): Promise<Response> => {
    const form = new FormData();
    form.set("archive", new File([body as BufferSource], "backup.zip"));
    const { POST } = await import("@/app/api/backup/restore/route");
    return POST(new Request("http://localhost:3000/api/backup/restore", { method: "POST", body: form }));
  };

  const realArchive = async (): Promise<Uint8Array> => {
    const parts: Uint8Array[] = [];
    const { stream } = await buildBackup();
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) parts.push(chunk);
    return new Uint8Array(Buffer.concat(parts));
  };

  beforeEach(() => resetLimiters());
  afterEach(() => resetLimiters());

  it("spends nothing on a file it never even unpacks", async () => {
    const junk = new Uint8Array(200).fill(7);
    for (let i = 0; i < RESTORE_PER_HOUR + 3; i++) {
      const response = await post(junk);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("not a zip archive") });
    }
    // The owner's own archive still goes through, which is the whole point.
    createCard({ game: "mtg", name: "Ragavan" });
    expect((await post(await realArchive())).status).toBe(200);
  });

  it("spends it on archives it does unpack, and hands it back when one works", async () => {
    // An archive that reaches the inflating and is then refused has cost
    // something, so it counts.
    const badContent = async () => {
      const file = path.join(dir, `bad-${Math.random().toString(16).slice(2)}.db`);
      const db = openDatabase(file);
      db.pragma("journal_mode = DELETE");
      db.exec("INSERT INTO cards (game, name, quantity, condition, grading_status, external_ids, manual_graded, created_at, updated_at) VALUES ('__proto__','x',1,'NM','undecided','{}','{}','t','t')");
      db.close();
      const parts: Uint8Array[] = [];
      const entries = [
        { name: "manifest.json", body: new TextEncoder().encode("{}") },
        { name: "collectcollect.db", body: new Uint8Array(fs.readFileSync(file)) },
      ];
      for await (const chunk of zipStream(entries.map((e) => ({ name: e.name, size: e.body.length, chunks: () => [e.body] })))) parts.push(chunk);
      return new Uint8Array(Buffer.concat(parts));
    };

    for (let i = 0; i < RESTORE_PER_HOUR; i++) expect((await post(await badContent())).status).toBe(400);
    const refused = await post(await badContent());
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBeTruthy();

    // Which is not a wall the owner can be held behind by their own recovery:
    // clear the counter the way a successful restore does, and try again.
    resetLimiters();
    createCard({ game: "mtg", name: "Ragavan" });
    const archive = await realArchive();
    expect((await post(archive)).status).toBe(200);
    // A restore that worked gives the budget back, so a second one is not
    // refused for having followed the first.
    for (let i = 0; i < RESTORE_PER_HOUR; i++) expect((await post(archive)).status).toBe(200);
  });
});

/**
 * Next buffers a copy of every request body because src/proxy.ts exists, and
 * past that buffer it truncates instead of refusing — so a ceiling above it is
 * not a ceiling, it is a restore that fails as "expected multipart/form-data".
 * The two have to be one number, which means testing the number the *framework*
 * is handed, not the constant compared with itself.
 */
describe("how large an archive may be", () => {
  it("is the same number the framework will actually deliver", async () => {
    // Next parses the config string with its own vendored `bytes`
    // (node_modules/next/dist/server/config.js does `require('next/dist/compiled/bytes').parse`),
    // so parse it with the very same code rather than with a guess at its rules.
    const { parse } = createRequire(__filename)("next/dist/compiled/bytes") as { parse: (value: string) => number };
    expect(parse(MAX_REQUEST_SIZE)).toBe(MAX_REQUEST_BYTES);

    // And next.config.ts really does hand it that string.
    const config = (await import("../next.config")).default;
    expect(config.experimental?.proxyClientMaxBodySize).toBe(MAX_REQUEST_SIZE);
  });

  it("is at or above every ceiling a route enforces", () => {
    // Each from the route's own constant: a ceiling above the buffer cannot be
    // enforced, because anything over the buffer arrives truncated.
    for (const ceiling of [RESTORE_MAX_BYTES, UPLOAD_MAX_TOTAL_BYTES, UPLOAD_MAX_BYTES, IMPORT_MAX_BYTES]) {
      expect(ceiling).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
      expect(ceiling).toBeGreaterThan(0);
    }
  });
});
