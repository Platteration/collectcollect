import { auth } from "@/lib/auth";
import { createProxy } from "@collectcollect/core/proxy";
import { sessions } from "@/lib/sessions";

export const proxy = createProxy(auth, {
  // A cookie this app signed is still refused once its session was ended.
  sessions,
  // Paths that must stay reachable without a session, or the login page (and
  // the installed app's shell) cannot load.
  publicPaths: ["/login", "/api/auth", "/api/health", "/offline", "/manifest.webmanifest", "/icons", "/sw.js"],
  // Steam serves every item image, and only Steam.
  imageSources: ["https://community.cloudflare.steamstatic.com", "https://steamcommunity-a.akamaihd.net"],
});

export const config = {
  // Every path, the framework's own files and a missing favicon included:
  // each response leaves with the security headers, and the not-found page
  // Next drew for an unmatched path carried none. Only the development
  // server's hot-reload socket is left alone. Next parses this at build time,
  // so it cannot come from the shared package.
  matcher: ["/((?!_next/webpack-hmr).*)"],
};
