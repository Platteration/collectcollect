import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@collectcollect/core/http";
import { applyImport, previewImport } from "@/lib/import";
import { CATEGORIES, type Category } from "@/lib/types";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST — read a CSV of items. Without `apply` it only reports what it found, so
 * the owner can check the column mapping before anything is written.
 */
export async function POST(request: Request) {
  let body: { csv?: unknown; category?: unknown; apply?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Expected a JSON body");
  }
  if (typeof body.csv !== "string" || !body.csv.trim()) return jsonError("No CSV content");
  if (body.csv.length > MAX_BYTES) return jsonError("That file is larger than 8 MB", 413);

  // Object.hasOwn, not `in`: "constructor" is on every object's prototype.
  const category =
    typeof body.category === "string" && Object.hasOwn(CATEGORIES, body.category) ? (body.category as Category) : undefined;
  try {
    const preview = previewImport(body.csv, { category });
    if (!body.apply) return NextResponse.json({ preview });
    return NextResponse.json({ preview, result: applyImport(preview) });
  } catch (e) {
    return jsonError(`Could not read that file: ${errorMessage(e)}`, 400);
  }
}
