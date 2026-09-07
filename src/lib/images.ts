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
    const [r, g, b] = [data[0], data[1], data[2]];
    const max = Math.max(r, g, b) || 1;
    // Scale so very dark art still yields a visible tint.
    const scale = Math.min(255 / max, 1.9);
    const hex = (n: number) => Math.min(255, Math.round(n * scale)).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null;
  }
}

export async function saveUpload(file: File): Promise<{ name: string; bytes: number; color: string | null }> {
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
  return { name, bytes: output.length, color: await dominantColor(output) };
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
