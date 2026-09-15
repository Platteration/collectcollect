import { serviceWorkerResponse } from "@collectcollect/core/service-worker";

/** GET /sw.js — the service worker, one copy shared by both apps, with this app's name on its caches. */
export function GET() {
  return serviceWorkerResponse("collectcollect-skins");
}
