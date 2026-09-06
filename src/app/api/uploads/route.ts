import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/images";
import { errorMessage, jsonError } from "@/lib/http";

/** POST multipart/form-data with one or more `files`; returns stored upload names. */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected multipart/form-data");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return jsonError("No files received");
  try {
    const uploads = [];
    for (const file of files) uploads.push(await saveUpload(file));
    return NextResponse.json({ uploads });
  } catch (e) {
    return jsonError(errorMessage(e), 400);
  }
}
