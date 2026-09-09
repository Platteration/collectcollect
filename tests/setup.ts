import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach } from "vitest";

/**
 * Every test gets its own data directory. The card repository mirrors each
 * card to a Markdown file under DATA_DIR, and a test that wrote into the
 * project's real ./data would both pollute a developer's collection and let
 * one test see another's files.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-test-"));
process.env.DATA_DIR = path.join(root, "run-0");

let n = 0;
beforeEach(() => {
  n += 1;
  process.env.DATA_DIR = path.join(root, `run-${n}`);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
