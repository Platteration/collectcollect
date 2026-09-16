import { listGoals, saveGoal, goalFromChecklist } from "@/lib/goals";
import { isGame } from "@/lib/types";
import { jsonError, errorMessage } from "@/lib/http";

export async function GET() { return Response.json({ goals: listGoals() }); }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body?.fromSet) {
      if (!isGame(body.fromSet.game) || typeof body.fromSet.setId !== "string") return jsonError("Choose a fetched set");
      return Response.json({ goal: goalFromChecklist(body.fromSet.game, body.fromSet.setId, body.budget ?? null) }, { status: 201 });
    }
    return Response.json({ goal: saveGoal(body) }, { status: 201 });
  } catch (e) { return jsonError(errorMessage(e)); }
}
