import { buildBackup } from "@/lib/backup";
import { errorMessage, jsonError } from "@collectcollect/core/http";

/** GET — download the whole inventory as a zip: the database plus its plain-text copy. */
export async function GET() {
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
    return jsonError(`Backup failed: ${errorMessage(e)}`, 500);
  }
}
