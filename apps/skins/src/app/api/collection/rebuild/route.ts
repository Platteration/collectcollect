import { NextResponse } from "next/server";
import { listItems } from "@/lib/items";
import { errorMessage, jsonError, logError } from "@collectcollect/core/http";
import { mirrorEnabled, rebuildCollection } from "@/lib/markdown/mirror";

/** POST — rewrite every Markdown file from the database. */
export async function POST() {
  if (!mirrorEnabled()) return jsonError("The plain-text copy is switched off (SKINS_MARKDOWN_MIRROR=off)", 409);
  try {
    return NextResponse.json({ result: rebuildCollection(listItems()) });
  } catch (e) {
    logError("collection/rebuild", e);
    return jsonError(`Could not write the files: ${errorMessage(e)}`, 500);
  }
}
