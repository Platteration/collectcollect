import { buildBackup } from "@/lib/backup";
import { errorMessage, jsonError } from "@/lib/http";

/** GET — download the whole collection as a zip: database plus every photo. */
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
