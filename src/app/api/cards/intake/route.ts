import { NextResponse } from "next/server";
import { intakeCard } from "@/lib/cards";
import { errorMessage, jsonError } from "@/lib/http";
import type { CardInput } from "@/lib/types";

/**
 * POST — add a scanned card, merging into an existing row when there is exactly
 * one interchangeable match. Atomic, so parallel scans of the same card cannot
 * both create a row or both miss the other's increment.
 */
export async function POST(request: Request) {
  let body: CardInput;
  try {
    body = (await request.json()) as CardInput;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    const outcome = intakeCard(body);
    return NextResponse.json(outcome, { status: outcome.result === "created" ? 201 : 200 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
