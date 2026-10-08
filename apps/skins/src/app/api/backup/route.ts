import { buildBackup } from "@/lib/backup";
import { BusyError } from "@collectcollect/core/gate";
import { createThrottle } from "@collectcollect/core/throttle";
import { errorMessage, jsonError, logError } from "@collectcollect/core/http";

/** GET — download the whole inventory as a zip: the database plus its plain-text copy. */
/** Each download copies the whole database; six a minute is plenty for a person and nothing for a loop. */
export const throttle = createThrottle(6, 60_000, "backups");

export async function GET(request: Request) {
  const refused = throttle.check(request);
  if (refused) return refused;
  try {
    const { filename, stream } = await buildBackup();
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof BusyError) return jsonError(e.message, 409);
    logError("backup", e);
    return jsonError(`Backup failed: ${errorMessage(e)}`, 500);
  }
}
