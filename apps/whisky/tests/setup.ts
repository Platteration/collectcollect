import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach } from "vitest";
import { engine } from "@/lib/engine";

/**
 * Every test gets its own data directory and a fresh in-memory database. The
 * engine mirrors each item to a Markdown file under WHISKY_DATA_DIR, and a
 * test that wrote into the project's real ./data would both pollute a
 * developer's collection and let one test see another's files.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-whisky-test-"));
process.env.WHISKY_DATA_DIR = path.join(root, "run-0");

let n = 0;
beforeEach(() => {
  n += 1;
  process.env.WHISKY_DATA_DIR = path.join(root, `run-${n}`);
  engine.db.setDb(engine.db.openDatabase(":memory:"));
  engine.refresh.resetRefreshThrottle();
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
