import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, verifyToken } from "@/lib/auth";
import { securityHeaders } from "@/lib/security-headers";

/**
 * Paths that must stay reachable without a session: the login page and its
 * route, or nobody could sign in, and the health check, which no container
 * runtime signs in for.
 */
const PUBLIC = ["/login", "/api/auth", "/api/health"];

/**
 * The container's own liveness check. It arrives by address — 127.0.0.1 from
 * inside the container — whatever ALLOWED_HOSTS names, so a deployment that
 * lists only its domain would otherwise be reported unhealthy by the very
 * check meant to watch it. So this one path is not held to the host list.
 * What a rebound page gains by that is the version string, and only that: the
 * 403 it would otherwise get is a fixed sentence, and the route answers
 * nothing but `ok` and the version, which the shared contract asks it to.
 */
const HEALTH = "/api/health";

/**
 * Next's own assets: the hashed chunks under /_next/static, the image
 * optimiser and the favicon request every browser makes. They are answered
 * before any host or session logic — a login redirect on a stylesheet is a
 * login page with no styles, and a matcher used to keep the proxy off them
 * entirely — but they still carry the security headers, which a config-time
 * `headers()` entry once gave them and the README promises every response.
 * `public/` is empty, so there is no other static path to name.
 */
function isAsset(pathname: string): boolean {
  return pathname.startsWith("/_next/") || pathname === "/favicon.ico";
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
function hostname(authority: string): string {
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
 * such as a domain terminated by a reverse proxy.
 */
function hostAllowed(host: string): boolean {
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
 * Reject a state-changing request that a browser made from another site. There
 * is no CSRF token and no session at all in the default no-password setup, and
 * every write route is reachable with a CORS-safelisted content type, so a page
 * the owner merely visits could otherwise restore a crafted backup over the
 * collection or spend the API budget.
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

function forbidden(request: NextRequest, message: string) {
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: message }, { status: 403 });
  return new NextResponse(message, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * The security headers, on every response this file returns. They are decided
 * here rather than in `headers()` in next.config because a config entry is
 * evaluated once during `next build` and frozen into
 * `.next/routes-manifest.json`; the production server reads the manifest and
 * never consults the config again, so anything decided from the environment —
 * HSTS reads `APP_BASE_URL` — would carry the build machine's answer. The
 * Docker image is built without a `.env` and given one at `docker compose up`,
 * which is exactly that shape. `process.env` is passed as an object rather
 * than read field by field so that nothing can be substituted at build time.
 *
 * Every branch goes through here: the pass-through, the two refusals, the
 * login redirect and the assets are all things a browser acts on, and a
 * refusal that could be framed or a script that could be sniffed is still a
 * response.
 */
function secured(response: NextResponse): NextResponse {
  for (const { key, value } of securityHeaders(process.env)) response.headers.set(key, value);
  return response;
}

// No matcher: the proxy runs for every request, so every response carries the
// headers. What must not be gated is decided inside, by path.
export async function proxy(request: NextRequest) {
  return secured(isAsset(request.nextUrl.pathname) ? NextResponse.next() : await answer(request));
}

async function answer(request: NextRequest): Promise<NextResponse> {
  const host = (request.headers.get("host") ?? request.nextUrl.host).trim().toLowerCase();
  if (request.nextUrl.pathname !== HEALTH && !hostAllowed(hostname(host))) {
    return forbidden(request, "This server does not answer to that host name. Set ALLOWED_HOSTS to add it.");
  }
  if (crossSiteWrite(request, host)) {
    return forbidden(request, "Cross-site request refused.");
  }

  if (!authEnabled()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  if (await verifyToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  // An unauthenticated API call gets a status, not an HTML redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}
