import { randomBytes, randomUUID } from "node:crypto";
import { readZip, zipStream } from "@collectcollect/core/zip";
import { expect, test } from "./fixtures";

/**
 * A backup is the way back from a broken collection, so it has to restore
 * whole at the size a collection with photos reaches. Each request body passes
 * through a buffer Next keeps for the proxy, which cut every body at 10 MB
 * unless next.config.ts says otherwise; a larger backup reached the restore
 * route truncated and was refused as if it were not a backup at all.
 */
test("a backup larger than ten megabytes restores whole", async ({ request }) => {
  const download = await request.get("/api/backup");
  expect(download.status()).toBe(200);
  const entries = await readZip(new Uint8Array(await download.body()), { maxTotalBytes: 512 * 1024 * 1024, maxEntries: 100_000 });
  const photosBefore = entries.filter((entry) => entry.name.startsWith("uploads/")).length;

  // A photo of noise, which no compression shrinks, takes the archive past 10 MB.
  const padding = { name: `uploads/${randomUUID()}.jpg`, data: new Uint8Array(randomBytes(12 * 1024 * 1024)) };
  const parts: Uint8Array[] = [];
  for await (const part of zipStream([...entries, padding].map((entry) => ({ name: entry.name, size: entry.data.length, chunks: () => [entry.data] })))) parts.push(part);
  const archive = Buffer.concat(parts);
  expect(archive.length).toBeGreaterThan(10 * 1024 * 1024);

  const { items } = (await (await request.get("/api/items")).json()) as { items: unknown[] };
  const restored = await request.post("/api/backup/restore", { multipart: { archive: { name: "backup.zip", mimeType: "application/zip", buffer: archive } } });
  expect(restored.status(), await restored.text()).toBe(200);
  const { result } = (await restored.json()) as { result: { items: number; photos: number } };
  expect(result).toMatchObject({ items: items.length, photos: photosBefore + 1 });
  const after = (await (await request.get("/api/items")).json()) as { items: unknown[] };
  expect(after.items).toHaveLength(items.length);
});
