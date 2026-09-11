import os from "node:os";
import path from "node:path";

/**
 * The throwaway collections the end-to-end run works against.
 *
 * Two, not one: the password gate changes every route, so it needs a server
 * of its own. The paths come from the pid, so the config and the teardown
 * agree without a file to coordinate through, and two runs on one machine do
 * not collide.
 */
export const ROOT = path.join(os.tmpdir(), `collectcollect-e2e-${process.pid}`);

/** Written to freely by the specs. */
export const OPEN_DATA_DIR = path.join(ROOT, "open");
/** Behind a password. */
export const LOCKED_DATA_DIR = path.join(ROOT, "locked");

export const E2E_PASSWORD = "e2e-secret";
