import { NextResponse } from "next/server";
import { findSimilar } from "@/lib/cards";
import { DraftError, getScanDraft, patchScanDraft } from "@/lib/scan-drafts";
import { draftBody, draftError } from "@/lib/scan-http";
import type { CardInput } from "@/lib/types";

export async function GET(_request: Request, ctx: RouteContext<"/api/scan-drafts/[id]">) {
  const draft = getScanDraft((await ctx.params).id);
  if (!draft) return draftError(new DraftError("Scan not found", 404));
  const candidates = draft.input.game && draft.input.name ? findSimilar(draft.input as CardInput) : [];
  return NextResponse.json({ draft, candidates });
}
export async function PATCH(request: Request, ctx: RouteContext<"/api/scan-drafts/[id]">) {
  try {
    const body = await draftBody(request);
    return NextResponse.json({ draft: patchScanDraft((await ctx.params).id, body.revision, body as { input?: Partial<CardInput>; hint?: string; uploads?: string[] }) });
  } catch (e) { return draftError(e); }
}
