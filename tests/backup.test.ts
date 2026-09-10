import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupSummary, replacedCollections } from "@/lib/backup";
import { openDatabase, setDb } from "@/lib/db";

let dir: string;
const previousDataDir = process.env.DATA_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-backup-"));
  process.env.DATA_DIR = dir;
  setDb(openDatabase(":memory:"));
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
