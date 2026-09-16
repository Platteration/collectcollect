import { BodyLimitError, readFormDataLimited } from "@collectcollect/core/http";
import { NextResponse } from "next/server";
import { RESTORE_MAX_BYTES, restoreBackup, restoreThrottle } from "@/lib/backup";
import { BusyError } from "@collectcollect/core/gate";
import { errorMessage, jsonError, tooLarge } from "@collectcollect/core/http";

const TOO_LARGE = `That archive is larger than ${RESTORE_MAX_BYTES / 1024 / 1024} MB. Unpack it into the data directory by hand instead.`;

/** Shared with putting a replaced collection back: both are the same swap. */
export const throttle = restoreThrottle;

/**
 * POST multipart/form-data with an `archive` file — replace the inventory with
 * the contents of a backup. The inventory being replaced is moved aside rather
 * than deleted.
 */
export async function POST(request: Request) {
  const refused = throttle.check(request) ?? tooLarge(request, RESTORE_MAX_BYTES, TOO_LARGE);
  if (refused) return refused;
  let form: FormData;
  try {
    form = await readFormDataLimited(request, RESTORE_MAX_BYTES + 64 * 1024);
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected multipart/form-data with an archive");
  }
  const file = form.get("archive");
  if (!(file instanceof File) || file.size === 0) return jsonError("No archive received");
  if (file.size > RESTORE_MAX_BYTES) return jsonError(TOO_LARGE, 413);

  try {
    const result = await restoreBackup(new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ result });
  } catch (e) {
    if (e instanceof BusyError) return jsonError(e.message, 409);
    return jsonError(errorMessage(e), 400);
  }
}
