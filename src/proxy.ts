import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, verifyToken } from "@/lib/auth";

/** Paths that must stay reachable without a session, or the login page cannot load. */
const PUBLIC = ["/login", "/api/auth", "/offline", "/manifest.webmanifest", "/icons", "/sw.js"];

export async function proxy(request: NextRequest) {
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
