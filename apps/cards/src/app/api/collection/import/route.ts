import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/http";
import { IMPORT_MAX_BYTES, cardFilesFromZip, importCardFiles, isCardFileName } from "@/lib/markdown/restore";
import { tooLarge } from "@collectcollect/core/http";
import { createThrottle } from "@collectcollect/core/throttle";

const TOO_LARGE = `That is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB. Copy the folder into the data directory instead.`;

/**
 * POST multipart/form-data — read a collection back out of its Markdown files.
 * Send either a zip of the folder as `archive`, or the `.md` files themselves
 * as repeated `files` fields. Cards are matched on the id in each file, so
 * importing the same folder twice does not duplicate anything.
 */
/** Reading a folder back rewrites every card it names; six a minute is plenty. */
export const throttle = createThrottle(6, 60_000, "imports");

export async function POST(request: Request) {
  const refused = throttle.check(request) ?? tooLarge(request, IMPORT_MAX_BYTES, TOO_LARGE);
  if (refused) return refused;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected multipart/form-data with an archive or Markdown files");
  }

  const archive = form.get("archive");
  const loose = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const total = (archive instanceof File ? archive.size : 0) + loose.reduce((n, f) => n + f.size, 0);
  if (total === 0) return jsonError("No files received");
  if (total > IMPORT_MAX_BYTES) return jsonError(TOO_LARGE, 413);

  try {
    const files: Array<{ name: string; text: string }> = [];
    if (archive instanceof File && archive.size > 0) {
      files.push(...(await cardFilesFromZip(new Uint8Array(await archive.arrayBuffer()))));
    }
    for (const file of loose) {
      if (!isCardFileName(file.name)) continue;
      files.push({ name: file.name, text: await file.text() });
    }
    if (!files.length) return jsonError("Nothing in that upload looked like a card file");
    return NextResponse.json({ result: importCardFiles(files) });
  } catch (e) {
    return jsonError(errorMessage(e), 400);
  }
}
