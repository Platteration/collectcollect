import os from "node:os";
import path from "node:path";

/**
 * The throwaway inventory the end-to-end run works against.
 *
 * The config and the seed both run in Playwright's own process, so deriving it
 * from the pid gives them the same answer without a file to coordinate through,
 * and gives two runs on one machine different answers.
 */
export const E2E_DATA_DIR = path.join(os.tmpdir(), `collectcollect-skins-e2e-${process.pid}`);
