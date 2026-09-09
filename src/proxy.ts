import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, verifyToken } from "@/lib/auth";

/** Paths that must stay reachable without a session, or the login page cannot load. */
const PUBLIC = ["/login", "/api/auth"];

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

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? request.nextUrl.host).trim().toLowerCase();
  if (!hostAllowed(hostname(host))) {
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

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
