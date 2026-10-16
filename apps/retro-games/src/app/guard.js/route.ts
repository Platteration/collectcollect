import { domainGuardResponse } from "@collectcollect/core/domain/pwa";
import { engine } from "@/lib/engine";

/** GET /guard.js — the safety net every page loads first, one copy shared by every app, with this app's name in its note. */
export function GET() {
  return domainGuardResponse(engine.spec);
}
