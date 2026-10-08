import { NextResponse } from "next/server";
import { commitScanDraft } from "@/lib/scan-drafts";
import { draftBody, draftError } from "@/lib/scan-http";

export async function POST(request: Request, ctx: RouteContext<"/api/scan-drafts/[id]/commit">) {
  try {
    const body = await draftBody(request);
    return NextResponse.json(commitScanDraft((await ctx.params).id, body.revision, body.mode as "auto" | "merge" | "separate", typeof body.targetId === "number" ? body.targetId : undefined));
  } catch (e) { return draftError(e); }
}
