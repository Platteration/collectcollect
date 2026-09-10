import { NextResponse } from "next/server";
import { intakeItem } from "@/lib/items";
import { errorMessage, jsonError } from "@collectcollect/core/http";
import type { ItemInput } from "@/lib/types";

/**
 * Add an item, letting the server decide whether it joins something already
 * held. Doing that here rather than in the client is what keeps two imports of
 * the same inventory from each reading the old quantity and adding a copy.
 */
export async function POST(request: Request) {
  let body: ItemInput;
  try {
    body = (await request.json()) as ItemInput;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    const outcome = intakeItem(body);
    return NextResponse.json(outcome, { status: outcome.result === "created" ? 201 : 200 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
