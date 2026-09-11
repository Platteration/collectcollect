import { NextResponse } from "next/server";
import { errorMessage, jsonError, tooManyRequests } from "@/lib/http";
import { HOUR_MS, SET_REFRESH_PER_HOUR, rateLimit } from "@/lib/rate-limit";
import { refreshChecklist } from "@/lib/sets";
import { GAMES, has } from "@/lib/types";

/** POST { game, setName } — fetch the published checklist for one of your sets. */
export async function POST(request: Request) {
  let body: { game?: unknown; setName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Expected a JSON body");
  }
  if (!has(GAMES, body.game)) return jsonError("Unknown game");
  if (typeof body.setName !== "string" || !body.setName.trim()) return jsonError("Which set?");

  const limit = rateLimit("sets-refresh", SET_REFRESH_PER_HOUR, HOUR_MS);
  if (!limit.ok) {
    return tooManyRequests(`Too many checklist fetches in the last hour (limit ${SET_REFRESH_PER_HOUR}).`, limit.retryAfter);
  }

  try {
    const checklist = await refreshChecklist(body.game, body.setName);
    if (!checklist) {
      return jsonError(
        "No checklist could be found for that set. Its name may not match the source's, or this game has no checklist source.",
        404,
      );
    }
    return NextResponse.json({ setName: checklist.setName, cards: checklist.cards.length });
  } catch (e) {
    return jsonError(`Could not fetch that checklist: ${errorMessage(e)}`, 502);
  }
}
