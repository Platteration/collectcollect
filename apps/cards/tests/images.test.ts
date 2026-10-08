import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { deleteUpload, isValidUploadName, readUpload, saveUpload, thumbName, uploadPath } from "@/lib/images";
import { uploadsDir } from "@/lib/db";
import { GET } from "@/app/api/uploads/[name]/route";

async function photo(width = 1200, height = 1600): Promise<File> {
  const buffer = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer();
  return new File([buffer], "card.jpg", { type: "image/jpeg" });
}

const serve = (name: string, query = "") => GET(new Request(`http://app.test/api/uploads/${name}${query}`), { params: Promise.resolve({ name }) } as never);

describe("the small copy of a photo", () => {
  it("is written beside every upload, and served on request", async () => {
    const stored = await saveUpload(await photo());
    expect((await sharp(uploadPath(stored.name)).metadata()).height).toBe(1600);
    const small = await sharp(path.join(uploadsDir(), thumbName(stored.name))).metadata();
    expect(Math.max(small.width ?? 0, small.height ?? 0)).toBe(400);
    const full = await readUpload(stored.name);
    const thumb = await readUpload(stored.name, "thumb");
    expect(thumb!.length).toBeLessThan(full!.length);
    // Not an upload of its own: backups carry the photo, and the copy is made again from it.
    expect(isValidUploadName(thumbName(stored.name))).toBe(false);

    const res = await serve(stored.name, "?size=thumb");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect((await res.arrayBuffer()).byteLength).toBe(thumb!.length);
    expect((await (await serve(stored.name)).arrayBuffer()).byteLength).toBe(full!.length);
    expect((await serve(stored.name, "?size=huge")).status).toBe(400);
  });

  it("is made again from the photo when it is missing, as after a restore", async () => {
    const stored = await saveUpload(await photo(300, 350));
    const small = path.join(uploadsDir(), thumbName(stored.name));
    fs.unlinkSync(small);
    const data = await readUpload(stored.name, "thumb");
    expect(data).not.toBeNull();
    expect(fs.existsSync(small)).toBe(true);
    // A photo already smaller than the limit is not blown up.
    expect((await sharp(data!).metadata()).height).toBe(350);
    // No photo, no copy.
    expect(await readUpload("00000000-0000-0000-0000-000000000000.jpg", "thumb")).toBeNull();
    expect((await serve("00000000-0000-0000-0000-000000000000.jpg", "?size=thumb")).status).toBe(404);
  });

  it("goes when the photo goes", async () => {
    const stored = await saveUpload(await photo());
    await deleteUpload(stored.name);
    expect(fs.existsSync(uploadPath(stored.name))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir(), thumbName(stored.name)))).toBe(false);
  });
});

describe("what an upload may be", () => {
  const png = () => sharp({ create: { width: 20, height: 30, channels: 3, background: "#c94f2b" } }).png().toBuffer();
  const upload = (buffer: Buffer, type: string, name = "card.png") => new File([new Uint8Array(buffer)], name, { type });
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>');

  it("accepts only the types on the allowlist, not any image/* the client declares", async () => {
    // An SVG is a document for a vector parser, not one of the raster formats
    // this app believes it accepts.
    await expect(saveUpload(upload(SVG, "image/svg+xml", "card.svg"))).rejects.toThrow(/Unsupported file type/);
    await expect(saveUpload(upload(await png(), "image/gif"))).rejects.toThrow(/Unsupported file type/);
    await expect(saveUpload(upload(await png(), ""))).rejects.toThrow(/Unsupported file type/);
    for (const type of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
      await expect(saveUpload(upload(SVG, type, "card.svg"))).rejects.toThrow(/Unsupported file type/);
    }
    expect((await saveUpload(upload(await png(), "image/png"))).name).toMatch(/^[a-f0-9-]{36}\.jpg$/);
  });

  it("decides from the decoded bytes, not the declared type", async () => {
    await expect(saveUpload(upload(SVG, "image/png"))).rejects.toThrow(/not a JPEG, PNG, WebP or HEIC/);
    await expect(saveUpload(upload(Buffer.from("not an image at all"), "image/jpeg"))).rejects.toThrow(/not a JPEG, PNG, WebP or HEIC/);
  });

  it("refuses to decode more pixels than any photo has", async () => {
    // Under a megabyte of PNG, but 64 megapixels once decoded: sharp's own
    // ceiling is about four times that.
    const huge = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(huge.length).toBeLessThan(1024 * 1024);
    await expect(saveUpload(upload(huge, "image/png"))).rejects.toThrow(/more pixels than any photo/);
  });
});
