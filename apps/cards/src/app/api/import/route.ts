import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/http";
import { applyImport, previewImport } from "@/lib/import";
import { isGame } from "@/lib/types";
import { tooLarge } from "@collectcollect/core/http";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST — read a CSV of cards. Without `apply` it only reports what it found,
 * so the owner can check the column mapping before anything is written.
 */
export async function POST(request: Request) {
  // The CSV travels inside a JSON string, which can double its size; the
  // declared length is checked against that before the body is read.
  const refused = tooLarge(request, MAX_BYTES * 2 + 1024, "That file is larger than 8 MB");
  if (refused) return refused;
  let body: { csv?: unknown; game?: unknown; apply?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Expected a JSON body");
  }
  if (typeof body.csv !== "string" || !body.csv.trim()) return jsonError("No CSV content");
  if (body.csv.length > MAX_BYTES) return jsonError("That file is larger than 8 MB", 413);

  if (body.game !== undefined && body.game !== null && body.game !== "" && !isGame(body.game)) return jsonError("Unknown game");
  const game = isGame(body.game) ? body.game : undefined;
  try {
    const preview = previewImport(body.csv, { game });
    if (!body.apply) return NextResponse.json({ preview });
    return NextResponse.json({ preview, result: applyImport(preview) });
  } catch (e) {
    return jsonError(`Could not read that file: ${errorMessage(e)}`, 400);
  }
}
