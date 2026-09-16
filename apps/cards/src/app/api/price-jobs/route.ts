import { priceJobs } from "@/lib/price-jobs";
import { readBodyLimited, BodyLimitError } from "@collectcollect/core/http";
export const dynamic = "force-dynamic";
import { BusyError } from "@collectcollect/core/gate";
import { createThrottle } from "@collectcollect/core/throttle";
const throttle = createThrottle(6, 60_000, "price refreshes");
export function GET() { return Response.json({ job: priceJobs.latest() }); }
export async function POST(request: Request) {
  const refused = throttle.check(request);
  if (refused) return refused;
  try {
    const text = new TextDecoder().decode(await readBodyLimited(request, 100_000));
    const body: unknown = text ? JSON.parse(text) : {};
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected refresh options.");
    const options = body as { ids?: unknown; retryJobId?: unknown };
    if (options.ids !== undefined && (!Array.isArray(options.ids) || options.ids.some(id => !Number.isSafeInteger(id) || id <= 0))) throw new Error("ids must contain positive item IDs.");
    if (options.retryJobId !== undefined && (typeof options.retryJobId !== "string" || !/^[a-f0-9-]{36}$/.test(options.retryJobId))) throw new Error("Invalid refresh ID.");
    if (options.ids !== undefined && options.retryJobId !== undefined) throw new Error("Choose a selection or a previous job to retry, not both.");
    const job = typeof options.retryJobId === "string" ? priceJobs.retry(options.retryJobId) : priceJobs.start(options.ids as number[] | undefined);
    return Response.json({ job }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not start refresh." }, { status: error instanceof BodyLimitError ? 413 : error instanceof BusyError ? 409 : 400 });
  }
}
