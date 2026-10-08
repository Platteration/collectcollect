import { guardResponse } from "@collectcollect/core/guard";

/** GET /guard.js — the safety net every page loads first, one copy shared by both apps, with this app's name in its note. */
export function GET() {
  return guardResponse("CollectCollect Skins");
}
