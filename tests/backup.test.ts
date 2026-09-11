import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESTORE_MAX_BYTES, backupSummary, replacedCollections, restoreBackup } from "@/lib/backup";
import { createCard, listCards } from "@/lib/cards";
import { openDatabase, setDb } from "@/lib/db";
import { MAX_REQUEST_BYTES } from "@/lib/limits";
import { zipStream } from "@/lib/zip";

let dir: string;
const previousDataDir = process.env.DATA_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-backup-"));
  process.env.DATA_DIR = dir;
  // A restore replaces the database file, so these need one on disk rather than
  // the in-memory connection the other suites use.
  setDb(openDatabase(path.join(dir, "collectcollect.db")));
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

describe("how large an archive may be", () => {
  it("is the same number the proxy will actually deliver", () => {
    // Next buffers a copy of every request body because src/proxy.ts exists,
    // and past that buffer it truncates instead of refusing — so a ceiling
    // above it is not a ceiling, it is a restore that fails as "expected
    // multipart/form-data". The two have to be one number.
    expect(RESTORE_MAX_BYTES).toBe(MAX_REQUEST_BYTES);
  });
});
