/** One service worker for both apps, told apart by the name on its caches. */
const SOURCE = `/*
 * A deliberately small service worker: enough to make the app installable and
 * to open something sensible without a network, and nothing more.
 *
 * It never caches API responses or page HTML. Prices and the collection itself
 * change, and a stale answer about what something is worth would be worse than
 * no answer.
 *
 * The cache names carry the app's name. A service worker's scope is an origin,
 * and on activation it removes every cache it does not own — so the two apps
 * must be served from different origins (which two ports are), or each would
 * evict the other's.
 */
const VERSION = "v1";
const SHELL = \`__PREFIX__-shell-\${VERSION}\`;
const ASSETS = \`__PREFIX__-assets-\${VERSION}\`;
const OFFLINE_URL = "/offline";

const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The app's own data is never served from a cache.
  if (url.pathname.startsWith("/api/")) return;

  // Pages: always try the network, and fall back to the offline notice.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r ?? Response.error())));
    return;
  }

  // Build output is content-hashed, so it can be served from cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(ASSETS).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
`;

/**
 * The worker's script text for an app. Served from a route rather than a file
 * in `public`, so there is one copy of it and each app only names itself;
 * the cache prefix is the only thing that differs between them.
 */
export function serviceWorkerSource(cachePrefix: string): string {
  if (!/^[a-z0-9-]+$/.test(cachePrefix)) throw new Error("A cache prefix is lowercase letters, digits and hyphens");
  return SOURCE.replaceAll("__PREFIX__", cachePrefix);
}

/** The response a `/sw.js` route hands back: script, never cached long, allowed to control the whole origin. */
export function serviceWorkerResponse(cachePrefix: string): Response {
  return new Response(serviceWorkerSource(cachePrefix), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
}
