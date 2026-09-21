/**
 * The security headers every response carries, and the policy inside them.
 *
 * These are pure functions of an environment so that the proxy (`src/proxy.ts`)
 * can compute them per request, and so a test can ask for a deployment shape
 * it is not running in.
 */
type Env = Record<string, string | undefined>;

/**
 * The content security policy: a backstop for anything that slips past
 * React's escaping, and for the third-party URLs the app renders (card art and
 * price-source links, which are checked but come from outside).
 *
 * `'unsafe-inline'` for scripts is Next's inline bootstrap: a nonce would need
 * every page to be rendered per request. Images allow any https host plus the
 * blob: URLs the capture screens make for a photo that has not been uploaded
 * yet; `mediastream:` is the camera preview. `next dev` needs eval and its own
 * websocket, neither of which is in a built app.
 */
export function contentSecurityPolicy(env: Env = process.env): string {
  // `next dev` sets NODE_ENV=development and nothing else does, so the
  // loosenings below are asked for by name. Reading this as "anything that is
  // not production" was safe while the policy was frozen at build time, and is
  // not now that it is decided per request: a built server started with
  // NODE_ENV=staging, or with the variable unset, would serve `'unsafe-eval'`
  // and `ws:` to real users.
  const dev = env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' blob: mediastream:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Headers every response carries.
 *
 * HSTS is sent only when the deployment says it answers on https
 * (`APP_BASE_URL`): a browser is required to ignore it over plain http, but
 * announcing a year of https-only for `localhost` would be a poor way to find
 * that out.
 *
 * That decision has to be made against the environment of the *running*
 * server, which is why this is called from the proxy rather than from
 * `headers()` in next.config. A config `headers()` entry is evaluated once
 * during `next build` and frozen into `.next/routes-manifest.json`, so a
 * deployment that builds in CI or a Docker image and supplies `APP_BASE_URL`
 * only at `npm start` — the shape .env.example and the README describe — would
 * have got whatever the build machine's environment said, in both directions:
 * no HSTS for an https deployment, and a year of it announced over plain http
 * from an image built with an https base URL.
 *
 * Permissions-Policy keeps the camera for this origin: the scan screens open
 * it. Nothing here uses the microphone or location.
 */
export function securityHeaders(env: Env = process.env): Array<{ key: string; value: string }> {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // frame-ancestors covers this for current browsers; the old header costs
    // nothing and still means something to the older ones.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()" },
  ];
  if ((env.APP_BASE_URL ?? "").startsWith("https://")) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}
