import { NextResponse, type NextRequest } from "next/server";
import type { Auth, Revoked } from "./auth";
import { cookieSecure, servedOverHttps } from "./net";
import { requestSecurityError } from "./request-guard";

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
    // Stated, though Chromium would take it from script-src if it were missing:
    // the policy names where the service worker comes from.
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
  // or the request was sent to the https address APP_BASE_URL names, which
  // holds for a proxy the app was not told about (servedOverHttps). With
  // includeSubDomains, so every name under this host is held to https for a
  // year too: give the app a leaf name.
  if (https) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

/**
 * The gate every request passes through.
 *
 * Three jobs. Always, the request has to name a host this instance answers to,
 * a browser's cross-site write is refused, and a write to the JSON API has to
 * say it is JSON (`requestSecurityError`) — all ahead of the password gate, so
 * they hold in the default no-password setup. When a password is set,
 * nothing but the public paths is reachable without a session, and an API call
 * without one gets a status rather than a redirect. And every response leaves
 * with the security headers — pages, API answers, the framework's own files,
 * the not-found page, every refusal and every redirect — with every page render
 * handed a nonce for its inline scripts: Next reads it back out of the policy
 * on the request and applies it to its own scripts as well. Four answers never
 * reach this function: Next makes two first, its redirect for an address with a
 * repeated slash or a backslash and its 500 for a TRACE request, a method the
 * fetch standard will not build a Request for; and Node's HTTP parser makes two
 * before Next, a 400 for a method it does not know and a 431 for headers past
 * its limit (README, "The website").
 */
export function createProxy(auth: Auth, options: ProxyOptions | string[]) {
  const opts: ProxyOptions = Array.isArray(options) ? { publicPaths: options } : options;
  const healthPath = opts.healthPath ?? "/api/health";

  return async function proxy(request: NextRequest) {
    const nonce = makeNonce();
    // Per request, from the running server's environment (the proxy is not
    // evaluated at build time, so the Docker image reads the .env it starts
    // with): a LAN address listed beside an https domain stays plain http.
    const https = servedOverHttps(request);
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
    // A refusal is still a response a browser acts on, so it carries the headers
    // too, and it is said in the shape the caller reads: JSON to the API, text
    // to a page.
    const refuse = ({ status, message }: { status: number; message: string }) =>
      secure(
        pathname.startsWith("/api/")
          ? NextResponse.json({ error: message }, { status })
          : new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } }),
      );

    // The host list, the cross-site write check and the JSON rule
    // (request-guard.ts), ahead of the password gate. The health route is
    // exempt from the host list alone. A write's Origin must carry https
    // whenever the page is served that way: the answer HSTS takes above, or
    // COOKIE_SECURE=1, which is how an owner whose app is only ever reached
    // over https, through a proxy it was not told about, says so.
    const refused = requestSecurityError(request, { https: https || cookieSecure(request), anyHost: pathname === healthPath });
    if (refused) return refuse(refused);

    // An address with a trailing slash goes to the same one without it, as Next
    // would send it. Next's own redirect runs before this proxy and so left with
    // none of the headers above; each app's next.config.ts turns it off
    // (skipTrailingSlashRedirect) so that it is made here, the same 308 to the
    // same place, query included.
    if (pathname.length > 1 && pathname.endsWith("/")) {
      // A plain URL: a NextURL puts back the trailing slash it saw on the request.
      const url = new URL(request.url);
      url.pathname = pathname.replace(/\/+$/, "") || "/";
      return secure(NextResponse.redirect(url, 308));
    }

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
