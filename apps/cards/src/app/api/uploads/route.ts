import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/images";
import { errorMessage, jsonError } from "@/lib/http";
import { tooLarge } from "@collectcollect/core/http";
import { createThrottle } from "@collectcollect/core/throttle";

const MAX_FILES = 20;
const MAX_BYTES = 25 * 1024 * 1024;
/** Every photo is re-encoded through sharp, which is real work; thirty a minute is a busy scan session. */
export const throttle = createThrottle(30, 60_000, "uploads");

/** POST multipart/form-data with one or more `files`; returns stored upload names. */
export async function POST(request: Request) {
  const refused =
    throttle.check(request) ??
    tooLarge(request, MAX_FILES * MAX_BYTES, `A request may carry at most ${MAX_FILES} files of ${MAX_BYTES / 1024 / 1024} MB each`);
  if (refused) return refused;
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
