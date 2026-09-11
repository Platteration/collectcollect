import { auth } from "@/lib/auth";
import { createProxy } from "@collectcollect/core/proxy";

export const proxy = createProxy(auth, {
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
