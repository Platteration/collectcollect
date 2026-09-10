import { NextResponse } from "next/server";
import { declaredTooLarge, errorMessage, jsonError } from "@/lib/http";
import { applyImport, previewImport } from "@/lib/import";
import { GAMES, type Game } from "@/lib/types";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST — read a CSV of cards. Without `apply` it only reports what it found,
 * so the owner can check the column mapping before anything is written.
 */
export async function POST(request: Request) {
  // The JSON envelope is a little larger than the CSV inside it, so anything
  // whose body alone is over the limit cannot hold a CSV that is not.
  if (declaredTooLarge(request, MAX_BYTES)) return jsonError("That file is larger than 8 MB", 413);
  let body: { csv?: unknown; game?: unknown; apply?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Expected a JSON body");
  }
  if (typeof body.csv !== "string" || !body.csv.trim()) return jsonError("No CSV content");
  // Bytes, not UTF-16 code units: a CSV of accented names is not four times the limit.
  if (Buffer.byteLength(body.csv, "utf8") > MAX_BYTES) return jsonError("That file is larger than 8 MB", 413);

  const game = typeof body.game === "string" && body.game in GAMES ? (body.game as Game) : undefined;
  try {
    const preview = previewImport(body.csv, { game });
    if (!body.apply) return NextResponse.json({ preview });
    return NextResponse.json({ preview, result: applyImport(preview) });
  } catch (e) {
    return jsonError(`Could not read that file: ${errorMessage(e)}`, 400);
  }
}
