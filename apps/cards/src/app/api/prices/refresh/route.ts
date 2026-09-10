import { NextResponse } from "next/server";
import { refreshAll } from "@/lib/pricing/refresh";

/** POST — refresh prices for every card (`?stale=24` limits it to cards not refreshed in that many hours). */
export async function POST(request: Request) {
  const stale = new URL(request.url).searchParams.get("stale");
  const staleHours = stale !== null && Number.isFinite(Number(stale)) ? Number(stale) : undefined;
  const result = await refreshAll({ staleHours });
  return NextResponse.json(result);
}
