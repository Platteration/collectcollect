import { NextResponse } from "next/server";
import { putBack, replacedCollections, restoreThrottle } from "@/lib/backup";
import { BusyError } from "@collectcollect/core/gate";
import { errorMessage, jsonError } from "@/lib/http";
import { BodyLimitError, logError, readJsonLimited } from "@collectcollect/core/http";

/** GET — the collections a restore has moved aside, newest first. */
export async function GET() {
  try {
    return NextResponse.json({ replaced: replacedCollections() });
  } catch (e) {
    logError("backup/replaced", e);
    return jsonError(errorMessage(e), 500);
  }
}

/** POST `{ name }` — make one of them the live collection again. */
export async function POST(request: Request) {
  const refused = restoreThrottle.check(request);
  if (refused) return refused;
  let body: { name?: unknown };
  // A folder name is a few dozen bytes; a runaway client cannot buffer more.
  try {
    body = (await readJsonLimited(request, 4 * 1024)) as { name?: unknown };
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON body");
  }
  if (typeof body.name !== "string" || !body.name) return jsonError("Say which collection to put back");
  try {
    return NextResponse.json({ result: await putBack(body.name) });
  } catch (e) {
    if (e instanceof BusyError) return jsonError(e.message, 409);
    return jsonError(errorMessage(e), 400);
  }
}
