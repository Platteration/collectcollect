import { NextResponse, type NextRequest } from "next/server";
import type { Auth } from "./auth";

/**
 * The gate every request passes through when a password is set.
 *
 * Which paths stay open differs per app — one has a service worker and an
 * offline page, another may not — so the list is passed in. Everything else is
 * the same, and getting it wrong means either an unreachable login form or an
 * unguarded API.
 */
export function createProxy(auth: Auth, publicPaths: string[]) {
  return async function proxy(request: NextRequest) {
    if (!auth.authEnabled()) return NextResponse.next();

    const { pathname, search } = request.nextUrl;
    if (publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

    if (await auth.verifyToken(request.cookies.get(auth.SESSION_COOKIE)?.value)) return NextResponse.next();

    // An unauthenticated API call gets a status, not an HTML redirect.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  };
}

// There is deliberately no shared `matcher` here. Next reads it at build time
// by parsing the source, so it has to be a literal in each app's own proxy.ts;
// importing one from here fails the build rather than silently matching
// nothing, which at least means the mistake cannot ship.
