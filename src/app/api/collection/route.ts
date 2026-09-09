import { collectionFiles } from "@/lib/markdown/mirror";
import { errorMessage, jsonError } from "@/lib/http";
import { assertZippable, zipStream, type ZipEntry } from "@/lib/zip";

/**
 * GET — the plain-text collection as a zip: one Markdown file per card, an
 * index, and a note explaining the format. Small enough to keep anywhere, and
 * readable without this app ever running again.
 */
export async function GET() {
  try {
    const files = collectionFiles();
    if (!files.length) return jsonError("There is nothing in the collection yet", 404);
    const encoder = new TextEncoder();
    const entries: ZipEntry[] = files.map((file) => {
      const bytes = encoder.encode(file.text);
      return { name: file.name, size: bytes.length, chunks: () => [bytes] };
    });
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
        "Content-Disposition": `attachment; filename="collectcollect-markdown-${stamp}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return jsonError(`Could not package the collection: ${errorMessage(e)}`, 500);
  }
}
