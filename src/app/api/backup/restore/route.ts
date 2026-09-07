import { NextResponse } from "next/server";
import { restoreBackup } from "@/lib/backup";
import { errorMessage, jsonError } from "@/lib/http";

const MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * POST multipart/form-data with an `archive` file — replace the collection with
 * the contents of a backup. The collection being replaced is moved aside
 * rather than deleted.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected multipart/form-data with an archive");
  }
  const file = form.get("archive");
  if (!(file instanceof File) || file.size === 0) return jsonError("No archive received");
  if (file.size > MAX_BYTES) return jsonError("That archive is too large to restore through the browser", 413);

  try {
    const result = await restoreBackup(new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ result });
  } catch (e) {
    return jsonError(errorMessage(e), 400);
  }
}
