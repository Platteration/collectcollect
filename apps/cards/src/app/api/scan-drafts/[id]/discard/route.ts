import { NextResponse } from "next/server";
import { discardScanDraft } from "@/lib/scan-drafts";
import { draftBody, draftError } from "@/lib/scan-http";

export async function POST(request: Request, ctx: RouteContext<"/api/scan-drafts/[id]/discard">) {
  try { return NextResponse.json({ draft: discardScanDraft((await ctx.params).id, (await draftBody(request)).revision) }); }
  catch (e) { return draftError(e); }
}
