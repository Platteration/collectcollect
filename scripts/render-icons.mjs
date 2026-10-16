/**
 * Render an app's icons from its one SVG, with sharp.
 *
 * Each app has `scripts/icon.svg` (the mark on a rounded tile, drawn in the
 * app's colour) and a five-line `scripts/icons.mjs` that calls this, so
 * `npm run icons -w @collectcollect/<app>` rewrites its `public/icons` and
 * `public/favicon.ico`. The PNGs and the .ico are committed, so this only runs
 * when an icon changes; sharp is only ever used here, never by the running
 * app. The SVG lives beside the script rather than in `public/`, which a
 * server publishes whole: no page loads it, and a site serves only what its
 * pages use.
 *
 * What it writes, and who asks for it:
 *   icons/icon-192.png, icons/icon-512.png   the web manifest ("any")
 *   icons/maskable-512.png                   the web manifest ("maskable"):
 *                                            the tile inside the safe zone, on
 *                                            the app's dark ground
 *   icons/apple-touch-icon.png               the home screen on iOS
 *   favicon.ico                              the address bar, and what a
 *                                            browser asks for at /favicon.ico
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * An .ico holding PNG images: every browser reads one, and nothing here needs
 * the older bitmap encoding. Entries are 8-bit sizes, so each image is at
 * most 255 pixels wide.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    if (size < 1 || size > 255) throw new RangeError(`An .ico entry is 1 to 255 pixels, not ${size}`);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/**
 * Every file, by its path under `public/`, as bytes. `ground` is the app's
 * dark background (`spec.theme.dark`, which is also the web manifest's
 * background_color): the maskable icon is drawn on it, so the splash screen an
 * installed app opens with is the colour the icon sits on.
 */
export async function renderIconFiles(svg, ground) {
  if (!HEX.test(ground)) throw new Error(`The dark ground is a six-digit hex colour like #0b0e13, not ${JSON.stringify(ground)}`);
  const tile = (size) => sharp(svg).resize(size, size).png().toBuffer();
  // The maskable icon keeps its mark inside the safe zone: the middle 80%.
  const maskable = (size) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
        `<rect width="${size}" height="${size}" fill="${ground}"/>` +
        `<image href="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" x="${size * 0.1}" y="${size * 0.1}" width="${size * 0.8}" height="${size * 0.8}"/>` +
        `</svg>`,
    );
  return {
    "icons/icon-192.png": await tile(192),
    "icons/icon-512.png": await tile(512),
    "icons/apple-touch-icon.png": await tile(180),
    "icons/maskable-512.png": await sharp(maskable(512)).png().toBuffer(),
    "favicon.ico": ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await tile(size) })))),
  };
}

/** Render `svgPath` into `publicDir`, replacing the files there. */
export async function writeIcons({ svgPath, ground, publicDir }) {
  const files = await renderIconFiles(fs.readFileSync(svgPath), ground);
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.join(publicDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    console.log(`wrote ${name}`);
  }
}
