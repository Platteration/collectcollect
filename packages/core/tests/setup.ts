import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach } from "vitest";

/**
 * Every test gets its own data directory, so the mirror never writes into a
 * developer's collection and one test never sees another's files.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-core-test-"));
process.env.TESTDOMAIN_DATA_DIR = path.join(root, "run-0");
delete process.env.PRICECHARTING_TOKEN;

let n = 0;
beforeEach(() => {
  n += 1;
  process.env.TESTDOMAIN_DATA_DIR = path.join(root, `run-${n}`);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
