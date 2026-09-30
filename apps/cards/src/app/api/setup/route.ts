import { dismissSetup, setupStatus } from "@/lib/setup";
import { jsonError } from "@/lib/http";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
export async function GET() { return Response.json(setupStatus()); }
export async function PUT(request: Request) {
  try {
    // One boolean; a runaway client cannot buffer more than a few kilobytes here.
    const body = await readJsonLimited<{ dismissed?: unknown } | null>(request, 4 * 1024);
    const dismissed = body?.dismissed;
    if (typeof dismissed !== "boolean") return jsonError("Dismissed must be true or false");
    dismissSetup(dismissed);
    return Response.json(setupStatus());
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON object");
  }
}
