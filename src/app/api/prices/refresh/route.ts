import { NextResponse } from "next/server";
import { tooManyRequests } from "@/lib/http";
import { HOUR_MS, PRICE_REFRESH_PER_HOUR, rateLimit } from "@/lib/rate-limit";
import { refreshAll } from "@/lib/pricing/refresh";

/** POST — refresh prices for every card (`?stale=24` limits it to cards not refreshed in that many hours). */
export async function POST(request: Request) {
  const limit = rateLimit("prices-refresh", PRICE_REFRESH_PER_HOUR, HOUR_MS);
  if (!limit.ok) {
    return tooManyRequests(`Too many full refreshes in the last hour (limit ${PRICE_REFRESH_PER_HOUR}).`, limit.retryAfter);
  }
  const stale = new URL(request.url).searchParams.get("stale");
  const staleHours = stale !== null && Number.isFinite(Number(stale)) ? Number(stale) : undefined;
  // refreshAll folds concurrent callers into one pass; see src/lib/pricing/refresh.ts.
  const result = await refreshAll({ staleHours });
  return NextResponse.json(result);
}
