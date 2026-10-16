import { DOMAIN_PUBLIC_PATHS, domainAuth } from "@collectcollect/core/domain/auth";
import { createProxy } from "@collectcollect/core/proxy";

/**
 * The password gate, if WHISKY_APP_PASSWORD is set. Built from the same
 * id and prefix as the engine, but without importing it: the proxy bundle
 * must not carry the database along.
 *
 * The public paths are the login, the health check, and what the installed
 * app's shell needs before anyone has signed in: the manifest, icons,
 * favicon, service worker and offline notice (DOMAIN_PUBLIC_PATHS).
 */
export const proxy = createProxy(domainAuth("whisky", "WHISKY"), { publicPaths: [...DOMAIN_PUBLIC_PATHS] });

export const config = {
  // Every path, the framework's own files and a missing favicon included:
  // each response leaves with the security headers, and the not-found page
  // Next drew for an unmatched path carried none. Only the development
  // server's hot-reload socket is left alone. Next parses this at build time,
  // so it cannot come from the shared package.
  matcher: ["/((?!_next/webpack-hmr).*)"],
};
