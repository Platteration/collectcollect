/**
 * The largest request body either app accepts, in one place.
 *
 * Each app has a proxy (`src/proxy.ts`), so Next clones and buffers the body of
 * every request to let the proxy and the route handler each read it. Past
 * `experimental.proxyClientMaxBodySize` — 10 MB unless set — it *truncates*
 * rather than failing: "the request will not fail or return an error to the
 * client" (node_modules/next/dist/docs, proxyClientMaxBodySize). The route then
 * sees a body that ends mid-stream and answers as if the file were the wrong
 * kind. Any ceiling a route enforces above that buffer is therefore
 * unenforceable, and a restore of a backup over 10 MB — the app's way back from
 * a lost or broken collection — silently failed.
 *
 * Each app's next.config.ts sets the buffer from this number, and every route
 * ceiling is at or below it, so the two cannot drift. 64 MB is a size a 1-2 GB
 * container can hold twice over, which is what a restore needs (the archive and
 * its entries are both in memory); a larger collection is restored by unpacking
 * its zip into the data directory with the app stopped.
 */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

/** The same number in the string form next.config.ts takes. */
export const MAX_REQUEST_SIZE = `${MAX_REQUEST_BYTES / 1024 / 1024}mb`;

