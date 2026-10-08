import { NextResponse, type NextRequest } from "next/server";
import type { Auth, Revoked } from "./auth";
import { isSecureRequest } from "./net";

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
  permissions?: { camera?: boolean };  /** Where revoked sessions are recorded; without one, a signed cookie is good until it runs out. */
  sessions?: { revoked(): Revoked };
  /**
   * The one path the host allowlist does not apply to. A container's own
   * liveness check arrives by address — 127.0.0.1 from inside the container —
   * whatever ALLOWED_HOSTS names, so a deployment that lists only its domain
   * would otherwise be reported unhealthy by the very check meant to watch it.
   * What a rebound page gains by that is what the route answers to anyone:
   * whether the process is up. Defaults to "/api/health".
   */
  healthPath?: string;
}

/** The value of a fresh nonce, base64 so it survives an HTTP header. */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// `next dev` sets NODE_ENV=development and nothing else does, so the
// loosenings are asked for by name: "anything that is not production" would
// hand 'unsafe-eval' and a websocket to a server started with NODE_ENV=test or
// staging, which is serving real users.
export function contentSecurityPolicy(nonce: string, imageHosts: string[] = [], dev = process.env.NODE_ENV === "development"): string {
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
    // Nothing here sets a <base>, and one injected would re-point every
    // relative URL on the page.
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The headers every response carries, whatever it is. */
export function securityHeaders(csp: string, permissions: ProxyOptions["permissions"] = {}, secure = false): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    // A page's address names a card or an item, and the price-source links
    // carry names too; no referrer is sent anywhere.
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": `camera=(${permissions.camera ? "self" : ""}), microphone=(), geolocation=(), payment=()`,
    // Nothing here opens another origin's window, and nothing else may keep a
    // handle on this one.
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  // Only over TLS: sent on a plain-http answer it would be ignored, and a
  // proxy that terminates TLS is the one that says so (see TRUST_PROXY) —
  // or the deployment says it serves https (APP_BASE_URL), which holds for a
  // proxy the app was not told about. With includeSubDomains, so every name
  // under this host is held to https for a year too: give the app a leaf name.
  if (secure || servesHttps()) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

/**
 * Whether the deployment says it is reached over https. Read per request from
 * the running server's environment: the proxy is not evaluated at build time,
 * so the Docker image picks it up from the .env it is started with.
 */
function servesHttps(env: Record<string, string | undefined> = process.env): boolean {
  return (env.APP_BASE_URL ?? "").trim().toLowerCase().startsWith("https://");
}

/** Methods a browser may send cross-site without changing anything. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Names that cannot be pointed at this machine by a DNS answer the attacker
 * controls: addresses, single-label names, and the private-use suffixes.
 */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".lan", ".internal", ".home.arpa"];

/**
 * The name part of a Host or Origin authority, without the port, IPv6 brackets
 * or the trailing dot of a fully qualified name (which both sides lose, so it
 * cannot be used to slip past the list).
 */
export function hostname(authority: string): string {
  const value = authority.trim().toLowerCase();
  let host: string;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    host = end === -1 ? value.slice(1) : value.slice(1, end);
  } else {
    const colon = value.indexOf(":");
    host = colon === -1 ? value : value.slice(0, colon);
  }
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

/** After the port is gone, a remaining colon can only have come from an IPv6 literal. */
function isAddress(host: string): boolean {
  return host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Which Host headers this instance answers to. Nothing else validates the Host,
 * and the server listens on every interface, so without this a short-TTL name
 * that resolves first to the attacker's server and then to this box becomes
 * same-origin with the app and can read the whole collection (DNS rebinding).
 *
 * The default accepts the ways a self-hosted instance is actually reached — by
 * address, by the machine's own single-label name, or by an mDNS/private-use
 * name — none of which a public DNS record can impersonate. Set ALLOWED_HOSTS
 * (comma-separated, or `*` to disable the check) to reach it by any other name,
 * such as a domain terminated by a reverse proxy. One variable for both apps,
 * like TRUST_PROXY: it describes the machine, not the collection.
 */
export function hostAllowed(host: string): boolean {
  const configured = process.env.ALLOWED_HOSTS?.trim();
  if (configured) {
    if (configured === "*") return true;
    return configured
      .split(",")
      .map((entry) => hostname(entry))
      .filter(Boolean)
      .includes(host);
  }
  if (!host) return false;
  if (isAddress(host)) return true;
  if (!host.includes(".")) return true;
  return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Whether this is a state-changing request that a browser made from another
 * site. There is no CSRF token, and no session at all in the default
 * no-password setup, and every write route is reachable with a CORS-safelisted
 * content type, so a page the owner merely visits could otherwise restore a
 * crafted backup over the collection or spend the API budget.
 *
 * Only headers a browser sets are consulted: `curl` and scripts send neither,
 * and are left alone.
 */
function crossSiteWrite(request: NextRequest, host: string): boolean {
  if (READ_METHODS.has(request.method)) return false;

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return true;

  const origin = request.headers.get("origin");
  if (origin) {
    let authority: string;
    try {
      authority = new URL(origin).host.toLowerCase();
    } catch {
      return true; // including the opaque `null` origin
    }
    if (authority !== host) return true;
  }
  return false;
}

/**
 * The gate every request passes through.
 *
 * Three jobs. Always, the request has to name a host this instance answers to,
 * and a browser's cross-site write is refused — both ahead of the password
 * gate, so they hold in the default no-password setup. When a password is set,
 * nothing but the public paths is reachable without a session, and an API call
 * without one gets a status rather than a redirect. And every response leaves
 * with the security headers, with every page render handed a nonce for its one
 * inline script — Next reads it back out of the policy on the request and
 * applies it to its own scripts as well.
 */
export function createProxy(auth: Auth, options: ProxyOptions | string[]) {
  const opts: ProxyOptions = Array.isArray(options) ? { publicPaths: options } : options;
  const healthPath = opts.healthPath ?? "/api/health";

  return async function proxy(request: NextRequest) {
    const nonce = makeNonce();
    const csp = contentSecurityPolicy(nonce, opts.imageHosts);
    const headers = securityHeaders(csp, opts.permissions, isSecureRequest(request));
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
    const { pathname, search } = request.nextUrl;
    // A refusal is still a response a browser acts on, so it carries the headers too.
    const forbidden = (message: string) =>
      secure(
        pathname.startsWith("/api/")
          ? NextResponse.json({ error: message }, { status: 403 })
          : new NextResponse(message, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } }),
      );

    const host = (request.headers.get("host") ?? request.nextUrl.host).trim().toLowerCase();
    if (pathname !== healthPath && !hostAllowed(hostname(host))) {
      return forbidden("This server does not answer to that host name. Set ALLOWED_HOSTS to add it.");
    }
    if (crossSiteWrite(request, host)) return forbidden("Cross-site request refused.");

    if (!auth.authEnabled()) return next();

    if (opts.publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return next();

    try {
      if (await auth.verifyToken(request.cookies.get(auth.SESSION_COOKIE)?.value, Date.now(), opts.sessions?.revoked())) return next();
    } catch {
      return secure(NextResponse.json({ error: "Session records are temporarily unavailable" }, { status: 503 }));
    }

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
