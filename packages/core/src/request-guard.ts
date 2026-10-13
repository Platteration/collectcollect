import { isSecureRequest } from "./net";

/**
 * The browser boundary every request crosses before a route or the password
 * gate sees it, with or without a password: the name the request was sent
 * to, the site that sent a write, and what a write's body says it is.
 */

/** Methods a browser may send cross-site without changing anything. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Names that cannot be pointed at this machine by a DNS answer the attacker
 * controls: addresses, single-label names, and the private-use suffixes.
 */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".lan", ".internal", ".home.arpa"];

/** The routes that take multipart/form-data rather than JSON: their own size and archive checks apply. */
const MULTIPART_PATHS = new Set(["/api/uploads", "/api/backup/restore", "/api/collection/import"]);

/** Parse an authority strictly; credentials, paths and ambiguous ports are never hosts. */
function authority(value: string): URL | null {
  try {
    const url = new URL(`http://${value.trim()}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * The name part of an authority, lower-case, without its port or the trailing
 * dot of a fully qualified name (which both sides lose, so it cannot be used
 * to slip past the list). IPv6 keeps its brackets on both sides.
 */
function nameOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

/**
 * Which Host headers this instance answers to. Nothing else validates the Host,
 * and the server listens on every interface, so without this a short-TTL name
 * that resolves first to the attacker's server and then to this box becomes
 * same-origin with the app and can read the whole collection (DNS rebinding).
 *
 * The default accepts the ways a self-hosted instance is actually reached — by
 * address, by the machine's own single-label name, or by an mDNS/private-use
 * name — none of which a public DNS record can impersonate. ALLOWED_HOSTS
 * (comma-separated) replaces that default with the names it lists, and only
 * those: an operator who reaches the app by a domain names it, and one who
 * also reaches it on the LAN names that too. The private-use names are left
 * out once a list is set because a device on the same network can answer for
 * them (mDNS, a router that registers DHCP names under .lan), which the list
 * lets an operator close. `*` turns the check off. One variable for both
 * apps, like TRUST_PROXY: it describes the machine, not the collection.
 * Anything that does not parse as a bare host and port — credentials, a
 * path, a port that is not a number, nothing at all — is refused whatever
 * the list says.
 */
export function hostAllowed(value: string, configured = process.env.ALLOWED_HOSTS): boolean {
  const url = authority(value);
  if (!url) return false;
  const host = nameOf(url);
  const list = configured?.trim();
  if (list) {
    if (list === "*") return true;
    return list.split(",").some((entry) => {
      const allowed = authority(entry);
      return allowed !== null && nameOf(allowed) === host;
    });
  }
  // The URL parser has already turned every spelling of an IPv4 address
  // (0x7f.1, 2130706433) into four decimal parts, and bracketed an IPv6 one.
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return true;
  if (!host.includes(".")) return true;
  return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Whether a request carries any body bytes. HTTP gives a request a body only through
 * Transfer-Encoding or a non-zero Content-Length (RFC 9112 section 6.3); `request.body`
 * cannot say, because the proxy is handed a stream for every method but GET and HEAD,
 * empty or not. A length that is not a plain zero counts as a body, so a malformed one
 * fails closed.
 */
function carriesBody(request: Request): boolean {
  if (request.headers.has("transfer-encoding")) return true;
  const length = request.headers.get("content-length");
  return length !== null && !/^\s*0+\s*$/.test(length);
}

/** How the proxy saw the request, beyond the request itself. */
export interface GuardContext {
  /**
   * The page is served over https: a trusted proxy says the request came over
   * TLS, or it was sent to the https address APP_BASE_URL names
   * (`servedOverHttps`), or COOKIE_SECURE=1 says every page is. Decides the
   * scheme a write's Origin must carry. Defaults to what a trusted proxy says
   * (`isSecureRequest`).
   */
  https?: boolean;
  /** Skip the host list for this request: the container's own health check, which arrives by address. */
  anyHost?: boolean;
}

/**
 * Why the request is refused before anything else reads it, or null.
 *
 * - The Host has to be one this instance answers to (`hostAllowed`).
 * - A write (anything but GET, HEAD, OPTIONS) a browser sends from anywhere but
 *   this origin is refused: there is no CSRF token, and no session at all in
 *   the default no-password setup, so a page the owner merely visits could
 *   otherwise restore a crafted backup over the collection or spend the API
 *   budget. Sec-Fetch-Site must be `same-origin` when it is sent (a write the
 *   browser says no page started, `none`, is not this app either), and an
 *   Origin must be exactly this one — scheme, host and port — so an http page
 *   of the same name, which a network attacker can write into, cannot write to
 *   the https app in a browser too old to send Fetch Metadata. curl and
 *   scripts send neither header and are left alone; X-Forwarded-Host is never
 *   read.
 * - A write to the JSON API that declares a type or carries bytes must
 *   declare `application/json`: a `text/plain` form is a request any page can
 *   send without a preflight, and its bytes can parse as JSON. One that does
 *   neither — a DELETE, or an action POST such as a price refresh, from a
 *   script with no body — has nothing to parse and goes through; a browser
 *   form can never take that shape, since the browser always declares a
 *   form's type. The multipart routes keep their own size and archive checks.
 */
export function requestSecurityError(request: Request, context: GuardContext = {}): { status: number; message: string } | null {
  const host = (request.headers.get("host") ?? new URL(request.url).host).trim();
  if (!context.anyHost && !hostAllowed(host)) {
    return { status: 403, message: "This server does not answer to that host name. Set ALLOWED_HOSTS to add it." };
  }
  if (READ_METHODS.has(request.method.toUpperCase())) return null;

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return { status: 403, message: "Cross-site request refused." };
  const origin = request.headers.get("origin");
  if (origin) {
    const https = context.https ?? isSecureRequest(request);
    try {
      const expected = new URL(`${https ? "https:" : "http:"}//${host}`).origin;
      // The opaque `null` origin parses as nothing, and lands here too.
      if (new URL(origin).origin !== expected) throw new Error("Different origin");
    } catch {
      return { status: 403, message: "Cross-site request refused." };
    }
  }

  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/") && !MULTIPART_PATHS.has(path)) {
    const declared = request.headers.get("content-type");
    const type = declared?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json" && (declared !== null || carriesBody(request))) {
      return { status: 415, message: "Expected application/json" };
    }
  }
  return null;
}
