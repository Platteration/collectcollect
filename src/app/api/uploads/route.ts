import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/images";
import { declaredTooLarge, errorMessage, jsonError } from "@/lib/http";
import { MAX_REQUEST_BYTES } from "@/lib/limits";

const MAX_FILES = 20;
const MAX_BYTES = 25 * 1024 * 1024;
/**
 * The most a legal request can weigh, used to refuse a huge body unread. Twenty
 * files at the per-file ceiling would be 500 MB, which is past the proxy's body
 * buffer and so would arrive truncated rather than refused; the app's own
 * client posts one photo per request, so the request ceiling is the binding one.
 */
const MAX_TOTAL_BYTES = Math.min(MAX_FILES * MAX_BYTES, MAX_REQUEST_BYTES);

/** POST multipart/form-data with one or more `files`; returns stored upload names. */
export async function POST(request: Request) {
  if (declaredTooLarge(request, MAX_TOTAL_BYTES)) return jsonError("That upload is too large", 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Past the proxy's body buffer the body is truncated rather than refused
    // (see src/lib/limits.ts), and a truncated multipart body fails here — so
    // name the ceiling instead of blaming the request's type.
    return jsonError(`Expected multipart/form-data, and no more than ${MAX_TOTAL_BYTES / 1024 / 1024} MB of it.`);
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
