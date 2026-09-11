/*
 * A deliberately small service worker: enough to make the app installable and
 * to open something sensible without a network, and nothing more.
 *
 * It never caches API responses or page HTML. Prices and the inventory itself
 * change, and a stale answer about what something is worth would be worse than
 * no answer.
 *
 * The cache names carry this app's name. A service worker's scope is an
 * origin, and on activation it removes every cache it does not own — so the
 * two apps must be served from different origins (which two ports are), or
 * each would evict the other's.
 */
const VERSION = "v1";
const SHELL = `collectcollect-skins-shell-${VERSION}`;
const ASSETS = `collectcollect-skins-assets-${VERSION}`;
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
  // The inventory's own data is never served from a cache.
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
