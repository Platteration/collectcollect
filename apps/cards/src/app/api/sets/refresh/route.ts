import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/http";
import { refreshChecklist } from "@/lib/sets";
import { GAMES, type Game } from "@/lib/types";

/** POST { game, setName } — fetch the published checklist for one of your sets. */
export async function POST(request: Request) {
  let body: { game?: unknown; setName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Expected a JSON body");
  }
  if (typeof body.game !== "string" || !(body.game in GAMES)) return jsonError("Unknown game");
  if (typeof body.setName !== "string" || !body.setName.trim()) return jsonError("Which set?");

  try {
    const checklist = await refreshChecklist(body.game as Game, body.setName);
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
