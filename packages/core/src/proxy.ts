import { NextResponse, type NextRequest } from "next/server";
import type { Auth, Revoked } from "./auth";
import { isSecureRequest } from "./net";

/**
 * What a page is allowed to load, beyond itself, and who may pass the gate.
 *
 * Each app names where its images come from and whether it uses the camera;
 * everything else is the same for both. The policy is strict about scripts —
 * only this origin's own files and, through a per-request nonce, the inline
 * scripts the framework writes and the one that applies the theme before
 * first paint — because a script that is not ours is exactly what a stored
 * name or note must never be able to become.
 */
export interface ProxyOptions {
  /** Paths that stay reachable without a session, or the login page cannot load. */
  publicPaths: string[];
  /**
   * Where images may come from besides this origin: hosts, or a scheme such
   * as `https:` or `blob:`. Each one is there because something the app
   * really shows needs it; the browser suite fails on anything left out.
   */
  imageSources?: string[];
  /** Browser features the app uses; everything not named here is refused. */
  permissions?: { camera?: boolean };
  /**
   * API paths whose route names its own cache lifetime, which every other
   * API answer is denied (see `createProxy`). A header set here wins over the
   * route's own, so a route left off this list loses what it set.
   */
  cachedPaths?: string[];
  /** Where revoked sessions are recorded; without one, a signed cookie is good until it runs out. */
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

/**
 * Paths every app serves to anyone who may reach it, password or none: the
 * framework's content-hashed build output, which is the same for every
 * install and holds nothing of the collection (the login page needs it to
 * draw), and the files a website answers at fixed addresses for robots and
 * for people reporting a vulnerability. Each app adds its own in publicPaths.
 */
const SITE_PATHS = ["/_next/static", "/robots.txt", "/.well-known/security.txt", "/guard.js"];

/** The value of a fresh nonce, base64 so it survives an HTTP header. */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** How the policy differs by where it is served. */
export interface PolicyContext {
  /** `next dev`, which needs eval, inline styles and a websocket that a built server never does. */
  dev?: boolean;
  /** The page is served over https (see securityHeaders), so plain-http subresources are upgraded. */
  https?: boolean;
}

/**
 * The content security policy.
 *
 * Nothing is allowed unless it is named, and every source below was measured:
 * both apps' browser suites drive their production builds under exactly this
 * header and fail on any violation (`e2e/website.spec.ts`, and every other
 * spec through `e2e/fixtures.ts`), so a source something real needs cannot be
 * missing, and one added for nothing is a change someone has to explain.
 *
 * - Scripts: an inline script runs only with this response's nonce, which the
 *   framework stamps on its bootstrap and flight data and the layout on the
 *   theme script and the safety net. 'strict-dynamic' lets those load the
 *   framework's chunks and makes a browser that understands it ignore 'self',
 *   so markup injected into a page cannot load even one of this origin's own
 *   files; 'self' is the fallback for a browser that does not.
 * - Styles: the app's own stylesheets. React writes `style` props as `style`
 *   attributes, which carry the theme's variables, the charts' geometry and
 *   each card's colour, so style-src-attr allows inline attributes and
 *   nothing else: an injected `<style>` element, which can select and leak
 *   what the page shows, is still refused.
 * - Images: this origin's (icons, uploaded photos), plus what each app names.
 * - Fonts: the display face, which next/font serves from /_next/static/media.
 * - fetch reaches this origin's API only; the service worker and the web
 *   manifest are this origin's files.
 * - form-action 'self': the collection and inventory search boxes are plain
 *   GET forms that reload their own page, and nothing posts anywhere else.
 * - Media: none. The scan screen's live preview is a camera stream handed to
 *   `<video>` as an object, which no fetch directive governs.
 * - Not adopted, measured: `require-trusted-types-for 'script'`. The
 *   framework's chunk loader assigns script URLs as strings, so under it every
 *   navigation to a page whose code had not loaded yet threw and fell back to a
 *   full page load, the not-found page threw while drawing, and the service
 *   worker, registered from a string, was refused, so the app could neither
 *   install nor open offline.
 */
export function contentSecurityPolicy(nonce: string, imageSources: string[] = [], context: PolicyContext = {}): string {
  // `next dev` sets NODE_ENV=development and nothing else does, so the
  // loosenings are asked for by name: "anything that is not production" would
  // hand 'unsafe-eval' and a websocket to a server started with NODE_ENV=test
  // or staging, which is serving real users.
  const dev = context.dev ?? process.env.NODE_ENV === "development";
  return [
    "default-src 'none'",
    // React reconstructs server stacks with eval in development, and only there.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // The development overlay writes its own <style> elements; a built server has none.
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self'${imageSources.map((source) => ` ${source}`).join("")}`,
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
    // Like HSTS, only where the page itself came over https: on a plain-http
    // address on the owner's network it would send every script and
    // stylesheet to an https port nothing listens on.
    ...(context.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * The powerful features a page can ask the browser for, every one denied but
 * the camera on the card app, whose scan screen reads it. Nothing else in
 * either app reaches for any of them, so an injected script cannot either.
 * Every name is one Chromium recognises — a misspelt feature is ignored
 * without a word — and the browser suites read `document.featurePolicy` back
 * to hold the page to exactly this.
 */
export function permissionsPolicy(permissions: ProxyOptions["permissions"] = {}): string {
  return [
    "accelerometer=()",
    "autoplay=()",
    "browsing-topics=()",
    `camera=(${permissions.camera ? "self" : ""})`,
    "clipboard-read=()",
    "clipboard-write=()",
    "display-capture=()",
    "encrypted-media=()",
    "fullscreen=()",
    "gamepad=()",
    "geolocation=()",
    "gyroscope=()",
    "hid=()",
    "idle-detection=()",
    "interest-cohort=()",
    "local-fonts=()",
    "magnetometer=()",
    "microphone=()",
    "midi=()",
    "payment=()",
    "picture-in-picture=()",
    "publickey-credentials-create=()",
    "publickey-credentials-get=()",
    "screen-wake-lock=()",
    "serial=()",
    "usb=()",
    "window-management=()",
    "xr-spatial-tracking=()",
  ].join(", ");
}

/** The headers every response carries, whatever it is. */
export function securityHeaders(csp: string, permissions: ProxyOptions["permissions"] = {}, https = false): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    // For browsers that predate frame-ancestors.
    "X-Frame-Options": "DENY",
    // A page's address names a card or an item, and the price-source links
    // carry names too; no referrer is sent anywhere.
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": permissionsPolicy(permissions),
    // Nothing here opens another origin's window, and nothing else may keep a
    // handle on this one.
    "Cross-Origin-Opener-Policy": "same-origin",
    // Nothing here is meant to be embedded by another site: a photo, a chart
    // or a script loaded from elsewhere is refused by the browser.
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  // Only over TLS: sent on a plain-http answer it would be ignored, and a
  // proxy that terminates TLS is the one that says so (see TRUST_PROXY) —
  // or the deployment says it serves https (APP_BASE_URL), which holds for a
  // proxy the app was not told about. With includeSubDomains, so every name
  // under this host is held to https for a year too: give the app a leaf name.
  if (https) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
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
 * with the security headers — pages, API answers, the framework's own files,
 * the not-found page and every refusal — with every page render handed a
 * nonce for its inline scripts: Next reads it back out of the policy on the
 * request and applies it to its own scripts as well.
 */
export function createProxy(auth: Auth, options: ProxyOptions | string[]) {
  const opts: ProxyOptions = Array.isArray(options) ? { publicPaths: options } : options;
  const healthPath = opts.healthPath ?? "/api/health";

  return async function proxy(request: NextRequest) {
    const nonce = makeNonce();
    const https = isSecureRequest(request) || servesHttps();
    const csp = contentSecurityPolicy(nonce, opts.imageSources, { https });
    const headers = securityHeaders(csp, opts.permissions, https);
    const { pathname, search } = request.nextUrl;
    const secure = (response: NextResponse) => {
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      // An API answer is the collection itself, what it cost and what it is
      // worth, and most routes said nothing about caching, which left it to
      // the browser to keep a copy on disk. A route on cachedPaths (an
      // uploaded photo, whose name never changes) keeps the lifetime it names.
      if (pathname.startsWith("/api/") && !(opts.cachedPaths ?? []).some((p) => pathname.startsWith(p))) {
        response.headers.set("Cache-Control", "no-store");
      }
      return response;
    };
    const next = () => {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-nonce", nonce);
      requestHeaders.set("Content-Security-Policy", csp);
      return secure(NextResponse.next({ request: { headers: requestHeaders } }));
    };
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

    if ([...SITE_PATHS, ...opts.publicPaths].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return next();

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
