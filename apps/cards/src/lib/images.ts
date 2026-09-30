import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { uploadsDir } from "./db";
import { lookup } from "@collectcollect/core/lookup";
import { storageLock } from "./storage";

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

// Only what saveUpload writes: every upload is re-encoded to JPEG under a
// UUID, so a .png or .webp under a UUID is a file somebody else put there.
// The small copy beside it is not an upload: backups carry the photo alone,
// and the copy is made again from it wherever it is missing.
const NAME_RE = /^[a-f0-9-]{36}\.jpg$/;

export function isValidUploadName(name: string): boolean {
  return NAME_RE.test(name);
}

/** The long edge of the small copy the collection grid and dashboard show. */
export const THUMB_EDGE = 400;

export type UploadSize = "full" | "thumb";

/** The file name of an upload's small copy. */
export function thumbName(name: string): string {
  if (!isValidUploadName(name)) throw new Error("Invalid upload name");
  return name.replace(/\.jpg$/, ".thumb.jpg");
}

async function smallCopy(full: Buffer): Promise<Buffer> {
  return sharp(full, { failOn: "none" })
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/**
 * Persist an uploaded image. Everything is re-encoded to JPEG (max 2000px on
 * the long edge) so odd phone formats (HEIC, huge PNGs) become something both
 * the browser and the vision model handle well.
 */
/**
 * Average colour of the card art, used to tint that card's page. Sampled from
 * the middle of the image so the border and background matter less, and pushed
 * to a mid lightness so it reads against both themes.
 */
export async function dominantColor(buffer: Buffer): Promise<string | null> {
  try {
    const img = sharp(buffer, { failOn: "none" }).rotate();
    const { width = 0, height = 0 } = await img.metadata();
    if (!width || !height) return null;
    const inset = { left: Math.round(width * 0.2), top: Math.round(height * 0.2), width: Math.round(width * 0.6), height: Math.round(height * 0.6) };
    const { data } = await img.extract(inset).resize(1, 1, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = data;
    if (r === undefined || g === undefined || b === undefined) return null;
    const max = Math.max(r, g, b) || 1;
    // Scale so very dark art still yields a visible tint.
    const scale = Math.min(255 / max, 1.9);
    const hex = (n: number) => Math.min(255, Math.round(n * scale)).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null;
  }
}

export interface StoredUpload { name: string; bytes: number; color: string | null }
export async function saveUpload(file: File, onStored?: (upload: StoredUpload) => void): Promise<StoredUpload> {
  if (!lookup(ALLOWED_IMAGE_TYPES, file.type) && !file.type.startsWith("image/")) {
    throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  }
  const input = Buffer.from(await file.arrayBuffer());
  if (input.length === 0) throw new Error("Empty file");
  const name = `${crypto.randomUUID()}.jpg`;
  const output = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const stored = { name, bytes: output.length, color: await dominantColor(output) };
  // A grid of two-thousand-pixel photos is megabytes a page; the tiles show
  // this instead, and the full photo is one click away.
  const thumb = await smallCopy(output);
  await storageLock.run(async () => {
    const file = path.join(uploadsDir(), name);
    const small = path.join(uploadsDir(), thumbName(name));
    await fs.writeFile(file, output);
    await fs.writeFile(small, thumb);
    try { onStored?.(stored); } catch (error) {
      await fs.unlink(file).catch(() => undefined);
      await fs.unlink(small).catch(() => undefined);
      throw error;
    }
  });
  return stored;
}

export function uploadPath(name: string): string {
  if (!isValidUploadName(name)) throw new Error("Invalid upload name");
  return path.join(uploadsDir(), name);
}

/**
 * An upload, or its small copy. A copy that is missing (a restore carries only
 * the photos; an upload from before copies were made has none) is made from
 * the photo on first request and kept.
 */
export async function readUpload(name: string, size: UploadSize = "full"): Promise<Buffer | null> {
  const file = size === "thumb" ? path.join(uploadsDir(), thumbName(name)) : uploadPath(name);
  try {
    return await fs.readFile(file);
  } catch {
    if (size === "full") return null;
  }
  const full = await readUpload(name);
  if (!full) return null;
  const small = await smallCopy(full);
  await storageLock.run(() => fs.writeFile(file, small)).catch(() => undefined);
  return small;
}

/** Downscale for the vision request: ~1568px long edge is the sweet spot for Claude. */
export async function prepareForVision(buffer: Buffer): Promise<{ data: string; mediaType: "image/jpeg" }> {
  const out = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { data: out.toString("base64"), mediaType: "image/jpeg" };
}

export async function deleteUpload(name: string): Promise<void> {
  try {
    await storageLock.run(async () => {
      await fs.unlink(path.join(uploadsDir(), thumbName(name))).catch(() => undefined);
      await fs.unlink(uploadPath(name));
    });
  } catch {
    /* already gone */
  }
}
