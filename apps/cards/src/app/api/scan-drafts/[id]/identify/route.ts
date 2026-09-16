import { NextResponse } from "next/server";
import { claimScanIdentification, finishScanIdentification } from "@/lib/scan-drafts";
import { draftBody, draftError } from "@/lib/scan-http";
import { identifyCard, isClaudeConfigured } from "@/lib/identify/claude";
import { identificationThrottle } from "@/lib/identify/throttle";
import { readUpload } from "@/lib/images";

export async function POST(request: Request, ctx: RouteContext<"/api/scan-drafts/[id]/identify">) {
  const refused = identificationThrottle.check(request);
  if (refused) return refused;
  try {
    const body = await draftBody(request);
    const id = (await ctx.params).id;
    const { draft, token } = claimScanIdentification(id, body.revision);
    try {
      if (!isClaudeConfigured()) throw new Error("Identification is not configured. Enter the card details by hand.");
      const images = [];
      for (const name of draft.uploads) {
        const buffer = await readUpload(name);
        if (!buffer) throw new Error("A saved photo is missing. Add another photo to continue.");
        images.push({ buffer });
      }
      const identification = await identifyCard(images, draft.hint, 300_000);
      return NextResponse.json({ draft: finishScanIdentification(id, token, identification) });
    } catch (e) {
      return NextResponse.json({ draft: finishScanIdentification(id, token, null, e instanceof Error ? e.message : "Identification failed") });
    }
  } catch (e) { return draftError(e); }
}
