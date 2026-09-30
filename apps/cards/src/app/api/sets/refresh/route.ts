import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/http";
import { refreshChecklist } from "@/lib/sets";
import { isGame } from "@/lib/types";
import { BodyLimitError, logError, readJsonLimited } from "@collectcollect/core/http";

/** POST { game, setName } — fetch the published checklist for one of your sets. */
export async function POST(request: Request) {
  let body: { game?: unknown; setName?: unknown; setCode?: unknown };
  // A game and a set name; a runaway client cannot buffer more than a few kilobytes here.
  try {
    body = (await readJsonLimited(request, 4 * 1024)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON body");
  }
  if (!isGame(body.game)) return jsonError("Unknown game");
  if (typeof body.setName !== "string" || !body.setName.trim()) return jsonError("Which set?");
  if (body.setName.length > 500 || (body.setCode !== undefined && (typeof body.setCode !== "string" || body.setCode.length > 100))) return jsonError("Set name or code is too long");

  try {
    const checklist = await refreshChecklist(body.game, body.setName, fetch, typeof body.setCode === "string" ? body.setCode : undefined);
    if (!checklist) {
      return jsonError(
        "No checklist could be found for that set. Its name may not match the source's, or this game has no checklist source.",
        404,
      );
    }
    return NextResponse.json({ setId: checklist.setId, setName: checklist.setName, cards: checklist.cards.length });
  } catch (e) {
    logError("sets/refresh", e);
    return jsonError(`Could not fetch that checklist: ${errorMessage(e)}`, 502);
  }
}
