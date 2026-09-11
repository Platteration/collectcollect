import { NextResponse } from "next/server";
import { putBack, replacedCollections } from "@/lib/backup";
import { errorMessage, jsonError } from "@/lib/http";

/** GET — the collections a restore has moved aside, newest first. */
export async function GET() {
  try {
    return NextResponse.json({ replaced: replacedCollections() });
  } catch (e) {
    return jsonError(errorMessage(e), 500);
  }
}

/** POST `{ name }` — make one of them the live collection again. */
export async function POST(request: Request) {
  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return jsonError("Expected a JSON body");
  }
  if (typeof body.name !== "string" || !body.name) return jsonError("Say which collection to put back");
  try {
    return NextResponse.json({ result: await putBack(body.name) });
  } catch (e) {
    return jsonError(errorMessage(e), 400);
  }
}
