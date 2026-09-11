/**
 * The largest request body this app accepts, in one place.
 *
 * `src/proxy.ts` exists, so Next clones and buffers the body of every request
 * to let the proxy and the route handler each read it. Past
 * `experimental.proxyClientMaxBodySize` it *truncates* rather than failing —
 * "the request will not fail or return an error to the client" — so the route
 * sees a body that ends mid-stream and answers "Expected multipart/form-data",
 * blaming the file. Any ceiling a route enforces above that buffer is therefore
 * unenforceable, and the documented restore path silently stopped working when
 * the proxy was added.
 *
 * next.config.ts sets the buffer from this number and every route ceiling is at
 * or below it, so the two cannot drift. 64 MB is a size a 1-2 GB container can
 * actually hold twice over, which is what a restore needs.
 */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

/** The same number in the string form next.config.ts takes. */
export const MAX_REQUEST_SIZE = `${MAX_REQUEST_BYTES / 1024 / 1024}mb`;

/**
 * Every ceiling a route enforces on a body, in the same file as the buffer they
 * all sit under, so "at or below the buffer" is a claim a test can check
 * (tests/backup.test.ts) rather than one each route makes on its own.
 */

/** Photos per request, and per photo — the app's own client posts one at a time. */
export const UPLOAD_MAX_FILES = 20;
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/**
 * The most a legal upload request can weigh, used to refuse a huge body unread.
 * Twenty files at the per-file ceiling would be 500 MB, which is past the body
 * buffer and so would arrive truncated rather than refused.
 */
export const UPLOAD_MAX_TOTAL_BYTES = Math.min(UPLOAD_MAX_FILES * UPLOAD_MAX_BYTES, MAX_REQUEST_BYTES);

/** A CSV import arrives as JSON, and is read into memory whole. */
export const IMPORT_MAX_BYTES = 8 * 1024 * 1024;
