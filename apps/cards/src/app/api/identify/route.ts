import { NextResponse } from "next/server";
import { identifyCard, IdentifyError } from "@/lib/identify/claude";
import { isValidUploadName, readUpload } from "@/lib/images";
import { errorMessage, jsonError } from "@/lib/http";

/**
 * POST { uploads: string[], hint?: string } — identify a single card from one
 * or more previously stored uploads (front / back / slab label).
 */
export async function POST(request: Request) {
  let body: { uploads?: unknown; hint?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body");
  }
  const names = Array.isArray(body.uploads) ? body.uploads.filter((n): n is string => typeof n === "string") : [];
  if (names.length === 0 || names.length > 4) return jsonError("Provide between 1 and 4 upload names");
  if (!names.every(isValidUploadName)) return jsonError("Invalid upload name");

  const images = [];
  for (const name of names) {
    const buffer = await readUpload(name);
    if (!buffer) return jsonError(`Upload not found: ${name}`, 404);
    images.push({ buffer });
  }
  try {
    const identification = await identifyCard(images, typeof body.hint === "string" ? body.hint : undefined);
    return NextResponse.json({ identification });
  } catch (e) {
    if (e instanceof IdentifyError) return jsonError(e.message, e.status);
    console.error("identify failed", e);
    return jsonError(`Identification failed: ${errorMessage(e)}`, 500);
  }
}
