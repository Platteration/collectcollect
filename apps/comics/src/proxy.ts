import { domainAuth } from "@collectcollect/core/domain/auth";
import { createProxy } from "@collectcollect/core/proxy";

/**
 * The password gate, if COMICS_APP_PASSWORD is set. Built from the same
 * id and prefix as the engine, but without importing it: the proxy bundle
 * must not carry the database along.
 */
export const proxy = createProxy(domainAuth("comics", "COMICS"), ["/login", "/api/auth"]);

export const config = {
  // Everything except Next's own assets and the favicon. Next parses this at
  // build time, so it cannot come from the shared package.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
