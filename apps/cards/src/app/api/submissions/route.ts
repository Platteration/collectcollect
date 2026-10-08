import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/http";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
import { createSubmission, listSubmissions, type SubmissionInput } from "@/lib/submissions";

export async function GET() {
  return NextResponse.json({ submissions: listSubmissions() });
}

export async function POST(request: Request) {
  let body: SubmissionInput;
  // A batch's name, company, fees and notes are well under 16 KB; a runaway client cannot buffer more.
  try {
    body = (await readJsonLimited(request, 16 * 1024)) as SubmissionInput;
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON body");
  }
  try {
    return NextResponse.json({ submission: createSubmission(body) }, { status: 201 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
