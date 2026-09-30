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
