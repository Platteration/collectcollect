import { NextResponse } from "next/server";
import { errorMessage, jsonError, parseId } from "@/lib/http";
import {
  addCard,
  deleteSubmission,
  getSubmission,
  markSent,
  recordReturn,
  removeCard,
  updateSubmission,
  type GradeResult,
  type SubmissionInput,
} from "@/lib/submissions";

export async function GET(_request: Request, ctx: RouteContext<"/api/submissions/[id]">) {
  const id = parseId((await ctx.params).id);
  const submission = id ? getSubmission(id) : null;
  if (!submission) return jsonError("Submission not found", 404);
  return NextResponse.json({ submission });
}

interface PatchBody extends SubmissionInput {
  addCardId?: number;
  removeCardId?: number;
  markSent?: boolean;
  sentAt?: string;
  results?: GradeResult[];
  returnedAt?: string;
}

/** PATCH — edit details, add or remove a card, mark sent, or record what came back. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/submissions/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getSubmission(id)) return jsonError("Submission not found", 404);
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    let submission = getSubmission(id)!;
    if (body.addCardId) submission = addCard(id, body.addCardId);
    if (body.removeCardId) submission = removeCard(id, body.removeCardId);
    if (body.name !== undefined || body.company !== undefined || body.serviceLevel !== undefined || body.feePerCard !== undefined || body.shipping !== undefined || body.notes !== undefined) {
      submission = updateSubmission(id, body);
    }
    if (body.markSent) submission = markSent(id, body.sentAt);
    if (body.results) submission = recordReturn(id, body.results, body.returnedAt);
    return NextResponse.json({ submission });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/submissions/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id || !deleteSubmission(id)) return jsonError("Submission not found", 404);
  return NextResponse.json({ ok: true });
}
