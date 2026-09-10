import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/http";
import { createSubmission, listSubmissions, type SubmissionInput } from "@/lib/submissions";

export async function GET() {
  return NextResponse.json({ submissions: listSubmissions() });
}

export async function POST(request: Request) {
  let body: SubmissionInput;
  try {
    body = (await request.json()) as SubmissionInput;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    return NextResponse.json({ submission: createSubmission(body) }, { status: 201 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
