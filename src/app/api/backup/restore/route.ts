import { NextResponse } from "next/server";
import { RESTORE_MAX_BYTES, restoreBackup } from "@/lib/backup";
import { declaredTooLarge, errorMessage, jsonError } from "@/lib/http";

const TOO_BIG = `That archive is larger than ${RESTORE_MAX_BYTES / 1024 / 1024} MB. Unpack it into the data directory by hand instead.`;

/**
 * POST multipart/form-data with an `archive` file — replace the collection with
 * the contents of a backup. The collection being replaced is moved aside
 * rather than deleted.
 */
export async function POST(request: Request) {
  // Multipart framing adds very little, so a body over the ceiling cannot hold
  // an archive under it: refuse before the whole thing is buffered.
  if (declaredTooLarge(request, RESTORE_MAX_BYTES)) return jsonError(TOO_BIG, 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected multipart/form-data with an archive");
  }
  const file = form.get("archive");
  if (!(file instanceof File) || file.size === 0) return jsonError("No archive received");
  if (file.size > RESTORE_MAX_BYTES) return jsonError(TOO_BIG, 413);

  try {
    const result = await restoreBackup(new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ result });
  } catch (e) {
    return jsonError(errorMessage(e), 400);
  }
}
