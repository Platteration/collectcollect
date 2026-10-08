import fs from "node:fs/promises";
import path from "node:path";
import { assertZippable, fileChunks, zipStream, type ZipEntry } from "./zip";

/** Stream a finished private snapshot. No entry is read from the live collection. */
export async function stagedArchive(directory: string, filename: string): Promise<{ filename: string; stream: ReadableStream<Uint8Array> }> {
  const entries: ZipEntry[] = [];
  const discard = () => fs.rm(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
  async function visit(relative: string): Promise<void> {
    const folder = path.join(directory, relative);
    for (const entry of (await fs.readdir(/* turbopackIgnore: true */ folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const full = path.join(directory, name);
        entries.push({ name, size: (await fs.stat(/* turbopackIgnore: true */ full)).size, chunks: () => fileChunks(full) });
      } else throw new Error("A snapshot contains an unexpected file type");
    }
  }
  try { await visit(""); assertZippable(entries); } catch (error) { await discard(); throw error; }
  const iterator = zipStream(entries);
  return { filename, stream: new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) { controller.close(); await discard(); }
        else controller.enqueue(value);
      } catch (error) { controller.error(error); await discard(); }
    },
    async cancel() { await iterator.return(undefined); await discard(); },
  }) };
}
