import { NextResponse } from "next/server";
import { listCards } from "@/lib/cards";
import { errorMessage, jsonError } from "@/lib/http";
import { mirrorEnabled, rebuildCollection } from "@/lib/markdown/mirror";

/** POST — rewrite every Markdown file from the database. */
export async function POST() {
  if (!mirrorEnabled()) return jsonError("The plain-text copy is switched off (MARKDOWN_MIRROR=off)", 409);
  try {
    return NextResponse.json({ result: rebuildCollection(listCards()) });
  } catch (e) {
    return jsonError(`Could not write the files: ${errorMessage(e)}`, 500);
  }
}
