import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderIconFiles, writeIcons } from "../../../scripts/render-icons.mjs";

// A tile in the app's colour with a mark on it, as each app's scripts/icon.svg is.
const SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="112" fill="#b45309"/><circle cx="256" cy="256" r="96" fill="#ffffff"/></svg>`,
);

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return { r: data[at]!, g: data[at + 1]!, b: data[at + 2]!, a: info.channels === 4 ? data[at + 3]! : 255 };
}

describe("rendering an app's icons from its one SVG", () => {
  it("writes every size the manifest and the browsers ask for", async () => {
    const files = await renderIconFiles(SVG, "#120c06");
    expect(Object.keys(files).sort()).toEqual(["favicon.ico", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"]);
    for (const [name, size] of [["icons/icon-192.png", 192], ["icons/icon-512.png", 512], ["icons/maskable-512.png", 512], ["icons/apple-touch-icon.png", 180]] as const) {
      const meta = await sharp(files[name]).metadata();
      expect([meta.format, meta.width, meta.height], name).toEqual(["png", size, size]);
    }
  });

  it("draws the maskable icon on the app's dark ground, the colour the manifest gives the splash screen, with the tile inside the safe zone", async () => {
    const { "icons/maskable-512.png": maskable, "icons/icon-512.png": any } = await renderIconFiles(SVG, "#120c06");
    // A phone may crop it to a circle: the corner is ground, and the tile and its mark are inside the middle 80%.
    expect(await pixel(maskable!, 0, 0)).toEqual({ r: 0x12, g: 0x0c, b: 0x06, a: 255 });
    expect(await pixel(maskable!, 511, 511)).toEqual({ r: 0x12, g: 0x0c, b: 0x06, a: 255 });
    expect(await pixel(maskable!, 256, 256)).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(await pixel(maskable!, 40, 256)).toEqual({ r: 0x12, g: 0x0c, b: 0x06, a: 255 });
    expect(await pixel(maskable!, 80, 256)).toMatchObject({ r: 0xb4, g: 0x53, b: 0x09 });
    // The "any" icon keeps its rounded tile: transparent outside the corners.
    expect((await pixel(any!, 0, 0)).a).toBe(0);
  });

  it("packs the favicon as an .ico of 16, 32 and 48 pixel PNGs that a browser can read", async () => {
    const { "favicon.ico": ico } = await renderIconFiles(SVG, "#120c06");
    expect([ico!.readUInt16LE(0), ico!.readUInt16LE(2), ico!.readUInt16LE(4)]).toEqual([0, 1, 3]);
    const sizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const entry = 6 + 16 * i;
      const [width, height, length, offset] = [ico!.readUInt8(entry), ico!.readUInt8(entry + 1), ico!.readUInt32LE(entry + 8), ico!.readUInt32LE(entry + 12)];
      const png = ico!.subarray(offset, offset + length);
      const meta = await sharp(png).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["png", width, height]);
      sizes.push(width);
    }
    expect(sizes).toEqual([16, 32, 48]);
    // Nothing trails the last image.
    const last = 6 + 16 * 2;
    expect(ico!.length).toBe(ico!.readUInt32LE(last + 12) + ico!.readUInt32LE(last + 8));
  });

  it("refuses a ground that is not a six-digit hex colour, which would land in the maskable SVG's markup", async () => {
    await expect(renderIconFiles(SVG, "#fff")).rejects.toThrow(/six-digit hex/);
    await expect(renderIconFiles(SVG, '#000000"/><script>')).rejects.toThrow(/six-digit hex/);
  });

  it("writes the files under public/, replacing what was there", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-icons-"));
    try {
      const svgPath = path.join(dir, "icon.svg");
      fs.writeFileSync(svgPath, SVG);
      const log = console.log;
      console.log = () => undefined;
      try {
        await writeIcons({ svgPath, ground: "#120c06", publicDir: path.join(dir, "public") });
      } finally {
        console.log = log;
      }
      for (const name of ["favicon.ico", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"]) {
        expect(fs.statSync(path.join(dir, "public", name)).size, name).toBeGreaterThan(100);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
