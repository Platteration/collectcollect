import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/images";
import { errorMessage, jsonError } from "@/lib/http";
import { BodyLimitError, readFormDataLimited, tooLarge } from "@collectcollect/core/http";
import { createThrottle } from "@collectcollect/core/throttle";
import { createScanDraft, getScanDraft, validDraftId } from "@/lib/scan-drafts";
import type { ScanDraft } from "@/lib/scan-types";

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
    form = await readFormDataLimited(request, MAX_FILES * MAX_BYTES + 64 * 1024);
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, e.status);
    return jsonError("Expected multipart/form-data");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return jsonError("No files received");
  if (files.length > MAX_FILES) return jsonError(`At most ${MAX_FILES} files per request`);
  const draftId = form.get("draftId");
  if (draftId !== null && (typeof draftId !== "string" || !validDraftId(draftId) || files.length !== 1)) return jsonError("A scan needs one photo and a valid draft ID");
  if (typeof draftId === "string") {
    const draft = getScanDraft(draftId);
    if (draft) return NextResponse.json({ draft, uploads: draft.uploads.map((name) => ({ name, color: draft.accentColor })) });
  }
  const tooBig = files.find((f) => f.size > MAX_BYTES);
  if (tooBig) return jsonError(`${tooBig.name || "A file"} is larger than ${MAX_BYTES / 1024 / 1024} MB`, 413);
  let draft: ScanDraft | undefined;
  const receipt = (saved: ScanDraft) => NextResponse.json({ draft: saved, uploads: saved.uploads.map((name) => ({ name, color: saved.accentColor })) });
  try {
    const uploads = [];
    for (const file of files) uploads.push(await saveUpload(file, typeof draftId === "string" ? (upload) => {
      draft = createScanDraft(draftId, upload);
      // A simultaneous replay won the receipt. The upload helper removes this unused file.
      if (draft.uploads[0] !== upload.name) throw new Error("Upload already recorded");
    } : undefined));
    return draft ? receipt(draft) : NextResponse.json({ uploads });
  } catch (e) {
    if (draft) return receipt(draft);
    return jsonError(errorMessage(e), 400);
  }
}
