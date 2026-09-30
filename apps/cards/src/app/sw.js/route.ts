import { buildVersion } from "@collectcollect/core/build-id";
import { serviceWorkerResponse } from "@collectcollect/core/service-worker";

/** GET /sw.js — the service worker, one copy shared by both apps, with this app's name on its caches and this build's id as their version. */
export function GET() {
  return serviceWorkerResponse("collectcollect", buildVersion());
}
