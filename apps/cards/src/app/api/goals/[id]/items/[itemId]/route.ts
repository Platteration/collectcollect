import { deleteGoalItem, getGoalItem, saveGoalItem } from "@/lib/goals";
import { jsonError, errorMessage } from "@/lib/http";
type Context = { params: Promise<{ id: string; itemId: string }> };
export async function PUT(request: Request, { params }: Context) {
  const { id, itemId } = await params;
  if (getGoalItem(itemId)?.goalId !== id) return jsonError("Wanted card not found", 404);
  try { return Response.json({ item: saveGoalItem(id, await request.json(), itemId) }); }
  catch (e) { return jsonError(errorMessage(e)); }
}
export async function DELETE(_request: Request, { params }: Context) {
  const { id, itemId } = await params;
  return deleteGoalItem(id, itemId) ? Response.json({ ok: true }) : jsonError("Wanted card not found", 404);
}
