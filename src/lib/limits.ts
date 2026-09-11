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
