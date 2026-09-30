import { listGoals, saveGoal, goalFromChecklist } from "@/lib/goals";
import { isGame } from "@/lib/types";
import { jsonError, errorMessage } from "@/lib/http";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";

export async function GET() { return Response.json({ goals: listGoals() }); }
export async function POST(request: Request) {
  try {
    // A goal is a name, a budget and a date; a runaway client cannot buffer more than 16 KB here.
    const body = await readJsonLimited<{ fromSet?: { game?: unknown; setId?: unknown } | null; budget?: unknown } | null>(request, 16 * 1024);
    if (body?.fromSet) {
      if (!isGame(body.fromSet.game) || typeof body.fromSet.setId !== "string") return jsonError("Choose a fetched set");
      return Response.json({ goal: goalFromChecklist(body.fromSet.game, body.fromSet.setId, (body.budget ?? null) as number | null) }, { status: 201 });
    }
    return Response.json({ goal: saveGoal(body) }, { status: 201 });
  } catch (e) { return jsonError(errorMessage(e), e instanceof BodyLimitError ? e.status : 400); }
}
