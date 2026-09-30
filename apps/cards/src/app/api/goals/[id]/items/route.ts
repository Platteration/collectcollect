import { getGoal, saveGoalItem } from "@/lib/goals";
import { jsonError, errorMessage } from "@/lib/http";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getGoal(id)) return jsonError("Goal not found", 404);
  // A wanted card is a name, a set and a number; a runaway client cannot buffer more than 16 KB here.
  try { return Response.json({ item: saveGoalItem(id, await readJsonLimited(request, 16 * 1024)) }, { status: 201 }); }
  catch (e) { return jsonError(errorMessage(e), e instanceof BodyLimitError ? e.status : 400); }
}
