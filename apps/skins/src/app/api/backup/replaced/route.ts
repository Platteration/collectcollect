import { NextResponse } from "next/server";
import { putBack, replacedCollections, restoreThrottle } from "@/lib/backup";
import { BusyError } from "@collectcollect/core/gate";
import { BodyLimitError, errorMessage, jsonError, logError, readJsonLimited } from "@collectcollect/core/http";

/** GET — the inventories a restore has moved aside, newest first. */
export async function GET() {
  try {
    return NextResponse.json({ replaced: replacedCollections() });
  } catch (e) {
    logError("backup/replaced", e);
    return jsonError(errorMessage(e), 500);
  }
}

/** POST `{ name }` — make one of them the live inventory again. */
export async function POST(request: Request) {
  const refused = restoreThrottle.check(request);
  if (refused) return refused;
  let body: { name?: unknown };
  try {
    // A record the form sends is far under 4 KB; a runaway client cannot buffer more.
    body = (await readJsonLimited(request, 4 * 1024)) as { name?: unknown };
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON body");
  }
  if (typeof body.name !== "string" || !body.name) return jsonError("Say which inventory to put back");
  try {
    return NextResponse.json({ result: await putBack(body.name) });
  } catch (e) {
    if (e instanceof BusyError) return jsonError(e.message, 409);
    return jsonError(errorMessage(e), 400);
  }
}
