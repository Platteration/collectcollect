import { NextResponse, type NextRequest } from "next/server";
import type { Auth } from "./auth";

/**
 * What a page is allowed to load, beyond itself.
 *
 * Each app names the hosts its images come from; everything else is the same
 * for both. The policy is strict about scripts — only this origin's own files
 * and, through a per-request nonce, the one inline script that applies the
 * theme before first paint — because a script that is not ours is exactly
 * what a stored name or note must never be able to become.
 */
export interface ProxyOptions {
  /** Paths that stay reachable without a session, or the login page cannot load. */
  publicPaths: string[];
  /** Hosts images may come from, on top of this origin, data: and blob:. */
  imageHosts?: string[];
  /** Browser features the app uses; everything not named here is refused. */
  permissions?: { camera?: boolean };
}

/** The value of a fresh nonce, base64 so it survives an HTTP header. */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(nonce: string, imageHosts: string[] = [], dev = process.env.NODE_ENV !== "production"): string {
  return [
    "default-src 'self'",
    // React reconstructs server stacks with eval in development, and only there.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes carry the theme's CSS variables on to elements;
    // a nonce here would switch 'unsafe-inline' off, so there is none.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${imageHosts.map((host) => ` ${host}`).join("")}`,
    "font-src 'self'",
    // Hot reloading in development runs over a websocket to the same host.
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The headers every response carries, whatever it is. */
export function securityHeaders(csp: string, permissions: ProxyOptions["permissions"] = {}): Record<string, string> {
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": `camera=(${permissions.camera ? "self" : ""}), microphone=(), geolocation=(), payment=()`,
  };
}

/**
 * The gate every request passes through.
 *
 * Two jobs. When a password is set, nothing but the public paths is reachable
 * without a session, and an API call without one gets a status rather than a
 * redirect. Always, every response leaves with the security headers, and every
 * page render is handed a nonce for its one inline script — Next reads it back
 * out of the policy on the request and applies it to its own scripts as well.
 */
export function createProxy(auth: Auth, options: ProxyOptions | string[]) {
  const opts: ProxyOptions = Array.isArray(options) ? { publicPaths: options } : options;

  return async function proxy(request: NextRequest) {
    const nonce = makeNonce();
    const csp = contentSecurityPolicy(nonce, opts.imageHosts);
    const headers = securityHeaders(csp, opts.permissions);
    const secure = (response: NextResponse) => {
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    };
    const next = () => {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-nonce", nonce);
      requestHeaders.set("Content-Security-Policy", csp);
      return secure(NextResponse.next({ request: { headers: requestHeaders } }));
    };

    if (!auth.authEnabled()) return next();

    const { pathname, search } = request.nextUrl;
    if (opts.publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return next();

    if (await auth.verifyToken(request.cookies.get(auth.SESSION_COOKIE)?.value)) return next();

    // An unauthenticated API call gets a status, not an HTML redirect.
    if (pathname.startsWith("/api/")) {
      return secure(NextResponse.json({ error: "Not signed in" }, { status: 401 }));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return secure(NextResponse.redirect(url));
  };
}

// There is deliberately no shared `matcher` here. Next reads it at build time
// by parsing the source, so it has to be a literal in each app's own proxy.ts;
// importing one from here fails the build rather than silently matching
// nothing, which at least means the mistake cannot ship.
