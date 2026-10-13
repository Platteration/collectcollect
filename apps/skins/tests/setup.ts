import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach } from "vitest";

/**
 * Every test gets its own data directory. The item repository mirrors each item
 * to a Markdown file under SKINS_DATA_DIR, and a test that wrote into the
 * project's real ./data would both pollute a developer's inventory and let one
 * test see another's files.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-skins-test-"));
process.env.SKINS_DATA_DIR = path.join(root, "run-0");

// Sign-in with Google turns the gate on: neither app's from the shell running the tests.
for (const prefix of ["", "SKINS_"]) {
  for (const name of ["APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ALLOWED_SUBS", "GOOGLE_ALLOWED_EMAILS"]) delete process.env[`${prefix}${name}`];
}

let n = 0;
beforeEach(() => {
  n += 1;
  process.env.SKINS_DATA_DIR = path.join(root, `run-${n}`);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
