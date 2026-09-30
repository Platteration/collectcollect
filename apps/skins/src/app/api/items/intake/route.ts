import { NextResponse } from "next/server";
import { intakeItem } from "@/lib/items";
import { BodyLimitError, errorMessage, jsonError, readJsonLimited } from "@collectcollect/core/http";
import type { ItemInput } from "@/lib/types";

/**
 * Add an item, letting the server decide whether it joins something already
 * held. Doing that here rather than in the client is what keeps two imports of
 * the same inventory from each reading the old quantity and adding a copy.
 */
export async function POST(request: Request) {
  let body: ItemInput;
  try {
    // A record the form sends is far under 64 KB; a runaway client cannot buffer more.
    body = (await readJsonLimited(request, 64 * 1024)) as ItemInput;
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON body");
  }
  try {
    const outcome = intakeItem(body);
    return NextResponse.json(outcome, { status: outcome.result === "created" ? 201 : 200 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
