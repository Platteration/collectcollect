import { getGoal, saveGoalItem } from "@/lib/goals";
import { jsonError, errorMessage } from "@/lib/http";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getGoal(id)) return jsonError("Goal not found", 404);
  try { return Response.json({ item: saveGoalItem(id, await request.json()) }, { status: 201 }); }
  catch (e) { return jsonError(errorMessage(e)); }
}
