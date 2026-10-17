import { domainServiceWorkerResponse } from "@collectcollect/core/domain/pwa";
import { engine } from "@/lib/engine";

/** GET /sw.js — the service worker, one copy shared by every app, with this app's name on its caches and this build's id as their version. */
export function GET() {
  return domainServiceWorkerResponse(engine.spec);
}
