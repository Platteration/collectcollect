import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { uploadsDir } from "./db";

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const NAME_RE = /^[a-f0-9-]{36}\.(jpg|png|webp)$/;

export function isValidUploadName(name: string): boolean {
  return NAME_RE.test(name);
}

/**
 * Persist an uploaded image. Everything is re-encoded to JPEG (max 2000px on
 * the long edge) so odd phone formats (HEIC, huge PNGs) become something both
 * the browser and the vision model handle well.
 */
export async function saveUpload(file: File): Promise<{ name: string; bytes: number }> {
  if (!ALLOWED_IMAGE_TYPES[file.type] && !file.type.startsWith("image/")) {
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
  await fs.writeFile(path.join(uploadsDir(), name), output);
  return { name, bytes: output.length };
}

export function uploadPath(name: string): string {
  if (!isValidUploadName(name)) throw new Error("Invalid upload name");
  return path.join(uploadsDir(), name);
}

export async function readUpload(name: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(uploadPath(name));
  } catch {
    return null;
  }
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
    await fs.unlink(uploadPath(name));
  } catch {
    /* already gone */
  }
}
