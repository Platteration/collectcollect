import { deleteGoalItem, getGoalItem, saveGoalItem } from "@/lib/goals";
import { jsonError, errorMessage } from "@/lib/http";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
type Context = { params: Promise<{ id: string; itemId: string }> };
export async function PUT(request: Request, { params }: Context) {
  const { id, itemId } = await params;
  if (getGoalItem(itemId)?.goalId !== id) return jsonError("Wanted card not found", 404);
  // A wanted card is a name, a set and a number; a runaway client cannot buffer more than 16 KB here.
  try { return Response.json({ item: saveGoalItem(id, await readJsonLimited(request, 16 * 1024), itemId) }); }
  catch (e) { return jsonError(errorMessage(e), e instanceof BodyLimitError ? e.status : 400); }
}
export async function DELETE(_request: Request, { params }: Context) {
  const { id, itemId } = await params;
  return deleteGoalItem(id, itemId) ? Response.json({ ok: true }) : jsonError("Wanted card not found", 404);
}
