import { NextResponse } from "next/server";
import { getCard, updateCard } from "@/lib/cards";
import { errorMessage, jsonError, parseId } from "@/lib/http";
import { BodyLimitError, logError, readJsonLimited } from "@collectcollect/core/http";
import { createThrottle } from "@collectcollect/core/throttle";
import { agencyOf } from "@/lib/grading/agencies";
import { PsaError, isPsaConfigured, lookupCert } from "@/lib/grading/psa";
import { applyReport } from "@/lib/grading/report";

/** Each one spends one of PSA's daily lookups, so a loop is stopped early. */
export const throttle = createThrottle(10, 60_000, "cert lookups");

interface CertBody {
  company?: unknown;
  cert?: unknown;
  apply?: { identity?: unknown } | null;
}

/**
 * POST — fill this card from PSA's record of its cert: the grade, the label,
 * the population and PSA's own scans, and the card's blank identity fields
 * when asked. PSA is the one company with a lookup; the others are links.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/cards/[id]/cert">) {
  const refused = throttle.check(request);
  if (refused) return refused;
  const id = parseId((await ctx.params).id);
  const card = id ? getCard(id) : null;
  if (!card) return jsonError("Card not found", 404);
  let body: CertBody | null;
  // A company, a cert and a flag: nothing a client needs more than 4 KB for.
  try {
    body = (await readJsonLimited(request, 4 * 1024)) as CertBody | null;
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON body");
  }
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const agency = agencyOf(text(body?.company) ?? card.gradingCompany);
  if (!agency?.lookup) return jsonError("Only PSA offers a cert lookup. For the other companies open the report and enter it by hand.");
  const cert = text(body?.cert) ?? card.certNumber;
  if (!cert || !agency.certPattern.test(cert)) return jsonError(`A PSA cert number is ${agency.certHint}.`);
  if (!isPsaConfigured()) return jsonError("PSA cert lookup is not set up on this server. Add PSA_API_TOKEN to the environment and restart the app.", 503);
  try {
    const found = await lookupCert(cert, fetch, AbortSignal.timeout(15_000));
    if (!found.found) return jsonError(`PSA has no record of cert ${cert}.`, 404);
    const updated = updateCard(card.id, applyReport(card, found.report, { identity: body?.apply?.identity === true }));
    if (!updated) return jsonError("Card not found", 404);
    return NextResponse.json({ card: updated, report: found.report, imagesSkipped: found.imagesSkipped });
  } catch (e) {
    if (e instanceof PsaError) {
      // What PSA said, with how long to wait when it said that too.
      const res = jsonError(e.message, e.status);
      if (e.retryAfterMs) res.headers.set("Retry-After", String(Math.ceil(e.retryAfterMs / 1000)));
      return res;
    }
    logError("cards/cert", e);
    return jsonError(`Could not reach PSA: ${errorMessage(e)}`, 502);
  }
}
