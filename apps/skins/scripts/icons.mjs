/**
 * Render the app icon at every size the manifest lists, from one SVG.
 *
 *   npm run icons -w @collectcollect/skins
 *
 * The PNGs are committed, so this only runs when the icon changes. sharp is
 * a dev dependency here — the app itself never re-encodes an image.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const dir = path.join(import.meta.dirname, "..", "public", "icons");
const svg = fs.readFileSync(path.join(dir, "icon.svg"));

/** The maskable icon keeps its mark inside the safe zone: the middle 80%. */
const maskable = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" fill="#0b0e13"/>` +
      `<image href="data:image/svg+xml;base64,${svg.toString("base64")}" x="${size * 0.1}" y="${size * 0.1}" width="${size * 0.8}" height="${size * 0.8}"/>` +
      `</svg>`,
  );

const jobs = [
  ["icon-192.png", sharp(svg).resize(192, 192)],
  ["icon-512.png", sharp(svg).resize(512, 512)],
  ["apple-touch-icon.png", sharp(svg).resize(180, 180)],
  ["maskable-512.png", sharp(maskable(512))],
];
for (const [name, image] of jobs) {
  await image.png().toFile(path.join(dir, name));
  console.log(`wrote icons/${name}`);
}
