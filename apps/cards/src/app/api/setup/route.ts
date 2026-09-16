import { dismissSetup, setupStatus } from "@/lib/setup";
import { jsonError } from "@/lib/http";
export async function GET() { return Response.json(setupStatus()); }
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    if (typeof body?.dismissed !== "boolean") return jsonError("Dismissed must be true or false");
    dismissSetup(body.dismissed);
    return Response.json(setupStatus());
  } catch { return jsonError("Expected a JSON object"); }
}
