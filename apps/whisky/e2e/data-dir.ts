import os from "node:os";
import path from "node:path";

/**
 * The throwaway collections the end-to-end run works against.
 *
 * Three, not one. The reading specs are held to exact totals, so a spec that
 * adds a bottle or opens one must not share their collection — and the
 * password gate changes every route, so it needs a server of its own either
 * way.
 *
 * The paths come from the pid, so the config and the seed agree without a file
 * to coordinate through, and two runs on one machine do not collide.
 */
const ROOT = path.join(os.tmpdir(), `collectcollect-whisky-e2e-${process.pid}`);

/** Seeded, and never written to: the collection the reading specs measure. */
export const READ_DATA_DIR = path.join(ROOT, "read");
/** Empty, and written to freely: where adding, importing and opening are exercised. */
export const WRITE_DATA_DIR = path.join(ROOT, "write");
/** Behind a password. */
export const LOCKED_DATA_DIR = path.join(ROOT, "locked");

export const E2E_PASSWORD = "e2e-secret";
