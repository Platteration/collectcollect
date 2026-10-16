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

// Price sources are chosen from the environment, so a key in the shell running
// the tests would otherwise change which providers a test talks to.
delete process.env.PRICECHARTING_TOKEN;
delete process.env.POKEMONTCG_API_KEY;
delete process.env.PSA_API_TOKEN;
delete process.env.EBAY_CLIENT_ID;
delete process.env.EBAY_CLIENT_SECRET;
// Likewise sign-in with Google, which turns the gate on: neither app's from the shell.
for (const prefix of ["", "SKINS_"]) {
  for (const name of ["APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ALLOWED_SUBS", "GOOGLE_ALLOWED_EMAILS"]) delete process.env[`${prefix}${name}`];
}

let n = 0;
beforeEach(() => {
  n += 1;
  process.env.DATA_DIR = path.join(root, `run-${n}`);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
