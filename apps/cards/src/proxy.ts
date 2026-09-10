import { auth } from "@/lib/auth";
import { createProxy } from "@collectcollect/core/proxy";

/** Paths that must stay reachable without a session, or the login page cannot load. */
const PUBLIC = ["/login", "/api/auth", "/offline", "/manifest.webmanifest", "/icons", "/sw.js"];

export const proxy = createProxy(auth, PUBLIC);

export const config = {
  // Everything except Next's own assets and the favicon. Next parses this at
  // build time, so it cannot come from the shared package.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
