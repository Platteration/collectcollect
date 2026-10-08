import { collectionFiles } from "@/lib/markdown/mirror";
import { errorMessage, jsonError } from "@/lib/http";
import { assertZippable, fileChunks, zipStream, type ZipEntry } from "@collectcollect/core/zip";
import { createThrottle } from "@collectcollect/core/throttle";
import { logError } from "@collectcollect/core/http";

/**
 * GET — the plain-text collection as a zip: one Markdown file per card, an
 * index, and a note explaining the format. Small enough to keep anywhere, and
 * readable without this app ever running again.
 */
/** Each download reads every file in the folder; six a minute is plenty for a person and nothing for a loop. */
export const throttle = createThrottle(6, 60_000, "downloads");

export async function GET(request: Request) {
  const refused = throttle.check(request);
  if (refused) return refused;
  try {
    const files = collectionFiles();
    // The folder always holds its own explainer; a download of nothing but
    // that is not what anyone asked for.
    if (!files.some((file) => file.name.startsWith("cards/") || file.name.startsWith("goals/"))) {
      return jsonError("There is nothing in the collection yet", 404);
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
        // A file that vanishes mid-download ends the stream with an error the
        // client can see, rather than an unhandled rejection in the server.
        try {
          const { value, done } = await iterator.next();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (e) {
          logError("collection", e);
          controller.error(e);
        }
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
    logError("collection", e);
    return jsonError(`Could not package the collection: ${errorMessage(e)}`, 500);
  }
}
