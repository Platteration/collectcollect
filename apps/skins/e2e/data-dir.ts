import os from "node:os";
import path from "node:path";

/**
 * The throwaway inventories the end-to-end run works against.
 *
 * Three, not one. Specs that only read are held to exact totals, so a spec that
 * adds an item must not be pointed at the same inventory — and the password
 * gate changes every route, so it needs a server of its own either way.
 *
 * The paths come from the pid, so the config and the seed agree without a file
 * to coordinate through, and two runs on one machine do not collide.
 */
export const ROOT = path.join(os.tmpdir(), `collectcollect-skins-e2e-${process.pid}`);

/** Seeded, and never written to: the inventory the reading specs measure. */
export const READ_DATA_DIR = path.join(ROOT, "read");
/** Empty, and written to freely: where adding and importing are exercised. */
export const WRITE_DATA_DIR = path.join(ROOT, "write");
/** Behind a password. */
export const LOCKED_DATA_DIR = path.join(ROOT, "locked");

export const E2E_PASSWORD = "e2e-secret";
