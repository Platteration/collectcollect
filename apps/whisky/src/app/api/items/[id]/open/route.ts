import { NextResponse } from "next/server";
import { errorMessage, jsonError, parseId } from "@collectcollect/core/http";
import { engine } from "@/lib/engine";
import { openBottle } from "@/lib/open";

/** POST — open one copy of a bottle: it becomes its own row, frozen at today's value and outside the portfolio total. */
export async function POST(request: Request, ctx: RouteContext<"/api/items/[id]/open">) {
  const id = parseId((await ctx.params).id);
  if (!id || !engine.repo.getItem(id)) return jsonError("Bottle not found", 404);
  let body: { fillLevel?: unknown; at?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* an empty body means "now, full" */
  }
  const fillLevel = body.fillLevel === undefined || body.fillLevel === null ? undefined : Number(body.fillLevel);
  if (fillLevel !== undefined && !(Number.isFinite(fillLevel) && fillLevel >= 0 && fillLevel <= 100)) return jsonError("Fill level is a percentage");
  const at = typeof body.at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.at) ? body.at : undefined;
  try {
    return NextResponse.json({ item: openBottle(engine, id, { fillLevel, at }) });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
