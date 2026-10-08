import { NextResponse } from "next/server";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
import { DraftError } from "./scan-drafts";

export async function draftBody(request: Request): Promise<Record<string, unknown>> {
  const body = await readJsonLimited(request, 64 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DraftError("Expected a JSON object");
  return body as Record<string, unknown>;
}
export function draftError(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update this scan" },
    { status: error instanceof DraftError || error instanceof BodyLimitError ? error.status : 400 });
}
