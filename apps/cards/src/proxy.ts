import { auth } from "@/lib/auth";
import { createProxy } from "@collectcollect/core/proxy";
import { sessions } from "@/lib/sessions";

export const proxy = createProxy(auth, {
  // A cookie this app signed is still refused once its session was ended.
  sessions,
  // Paths that must stay reachable without a session, or the login page (and
  // the installed app's shell) cannot load.
  publicPaths: ["/login", "/api/auth", "/api/health", "/offline", "/manifest.webmanifest", "/icons", "/sw.js"],
  // Reference images come from whichever price source matched the card, so
  // any https host is allowed for images and nothing else.
  imageHosts: ["https:"],
  // Scan mode reads the camera.
  permissions: { camera: true },
});

export const config = {
  // Everything except Next's own endpoints — its static chunks, the image
  // optimiser, and in development the hot-reload socket, none of which is a
  // page or an API — and the favicon. Next parses this at build time, so it
  // cannot come from the shared package.
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
