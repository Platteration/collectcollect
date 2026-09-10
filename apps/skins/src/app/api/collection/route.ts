import { collectionFiles } from "@/lib/markdown/mirror";
import { errorMessage, jsonError } from "@collectcollect/core/http";
import { assertZippable, fileChunks, zipStream, type ZipEntry } from "@collectcollect/core/zip";

/**
 * GET — the plain-text inventory as a zip: one Markdown file per item, an
 * index, and a note explaining the format. Small enough to keep anywhere, and
 * readable without this app ever running again.
 */
export async function GET() {
  try {
    const files = collectionFiles();
    // The folder always holds its own explainer; a download of nothing but that
    // is not what anyone asked for.
    if (!files.some((file) => file.name.startsWith("items/"))) {
      return jsonError("There is nothing in the inventory yet", 404);
    }
    const entries: ZipEntry[] = files.map((file) => ({
      name: file.name,
      size: file.size,
      chunks: () => fileChunks(file.path),
    }));
    assertZippable(entries);

    const iterator = zipStream(entries);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="collectcollect-skins-${stamp}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return jsonError(`Could not package the inventory: ${errorMessage(e)}`, 500);
  }
}
