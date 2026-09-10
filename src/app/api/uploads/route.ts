import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/images";
import { declaredTooLarge, errorMessage, jsonError } from "@/lib/http";

const MAX_FILES = 20;
const MAX_BYTES = 25 * 1024 * 1024;
/** The most a legal request can weigh, used to refuse a huge body unread. */
const MAX_TOTAL_BYTES = MAX_FILES * MAX_BYTES;

/** POST multipart/form-data with one or more `files`; returns stored upload names. */
export async function POST(request: Request) {
  if (declaredTooLarge(request, MAX_TOTAL_BYTES)) return jsonError("That upload is too large", 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected multipart/form-data");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return jsonError("No files received");
  if (files.length > MAX_FILES) return jsonError(`At most ${MAX_FILES} files per request`);
  const tooBig = files.find((f) => f.size > MAX_BYTES);
  if (tooBig) return jsonError(`${tooBig.name || "A file"} is larger than ${MAX_BYTES / 1024 / 1024} MB`, 413);
  try {
    const uploads = [];
    for (const file of files) uploads.push(await saveUpload(file));
    return NextResponse.json({ uploads });
  } catch (e) {
    return jsonError(errorMessage(e), 400);
  }
}
