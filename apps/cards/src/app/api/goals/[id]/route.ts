import { deleteGoal, getGoal, saveGoal } from "@/lib/goals";
import { jsonError, errorMessage } from "@/lib/http";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  const goal = getGoal((await params).id);
  return goal ? Response.json({ goal }) : jsonError("Goal not found", 404);
}
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  if (!getGoal(id)) return jsonError("Goal not found", 404);
  // A goal is a name, a budget and a date; a runaway client cannot buffer more than 16 KB here.
  try { return Response.json({ goal: saveGoal(await readJsonLimited(request, 16 * 1024), id) }); }
  catch (e) { return jsonError(errorMessage(e), e instanceof BodyLimitError ? e.status : 400); }
}
export async function DELETE(_request: Request, { params }: Context) {
  return deleteGoal((await params).id) ? Response.json({ ok: true }) : jsonError("Goal not found", 404);
}
