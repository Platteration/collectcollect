import { NextResponse } from "next/server";
import { RESTORE_MAX_BYTES, restoreBackup } from "@/lib/backup";
import { declaredTooLarge, errorMessage, jsonError, tooManyRequests } from "@/lib/http";
import { HOUR_MS, RESTORE_PER_HOUR, clearRateLimit, rateLimit } from "@/lib/rate-limit";

const BUCKET = "backup-restore";

/** Thrown from the point where inflating starts, so the route can answer 429 from there. */
class RestoreLimited extends Error {
  constructor(readonly retryAfter: number) {
    super(`Too many restores in the last hour (limit ${RESTORE_PER_HOUR}).`);
  }
}

const MB = RESTORE_MAX_BYTES / 1024 / 1024;
const TOO_BIG = `That archive is larger than ${MB} MB. Unpack it into the data directory by hand instead.`;

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
    // A body over the proxy's buffer arrives truncated rather than refused (see
    // src/lib/limits.ts), and a truncated multipart body is exactly what fails
    // to parse here — so say what the ceiling is rather than blaming the file's
    // type, which is what this used to read as.
    return jsonError(`Expected multipart/form-data with an archive, and no more than ${MB} MB of it.`);
  }
  const file = form.get("archive");
  if (!(file instanceof File) || file.size === 0) return jsonError("No archive received");
  if (file.size > RESTORE_MAX_BYTES) return jsonError(TOO_BIG, 413);

  // A restore inflates every entry in the archive before it looks at a single
  // name, so it is one of the most expensive things this app can be asked to
  // do; it is also a once-in-a-while action. Limit it like the other expensive
  // routes rather than letting a small archive be sent over and over — but
  // spend the slot on the inflating, not on arriving. Charging at the door made
  // six 200-byte files that are not archives at all enough to close the app's
  // only recovery path for an hour, to the owner as much as to anyone else.
  const spend = () => {
    const limit = rateLimit(BUCKET, RESTORE_PER_HOUR, HOUR_MS);
    if (!limit.ok) throw new RestoreLimited(limit.retryAfter);
  };

  try {
    const result = await restoreBackup(new Uint8Array(await file.arrayBuffer()), { beforeInflate: spend });
    // A restore that worked is the thing this route is for, and the owner may
    // well need another one straight after; it is refusals that are worth
    // counting.
    clearRateLimit(BUCKET);
    return NextResponse.json({ result });
  } catch (e) {
    if (e instanceof RestoreLimited) return tooManyRequests(e.message, e.retryAfter);
    return jsonError(errorMessage(e), 400);
  }
}
