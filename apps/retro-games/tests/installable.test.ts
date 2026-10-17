import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DOMAIN_PUBLIC_PATHS } from "@collectcollect/core/domain/auth";
import { appMetadata } from "@collectcollect/core/pages/AppShell";
import manifest from "@/app/manifest";
import { GET as worker } from "@/app/sw.js/route";
import { spec } from "@/lib/spec";

/**
 * What installing the app needs from its own files. The icons are committed
 * PNGs and an .ico, drawn from scripts/icon.svg by `npm run icons`, and
 * nothing in a build checks them, so this holds them to what the manifest and
 * the page's links promise: they exist, at the size said, and the maskable one
 * sits on the same ground as the splash screen. A scaffolded app has none of
 * this until `npm run icons` has run; copy this file in once it has.
 */
const root = path.resolve(import.meta.dirname, "..");
const publicDir = path.join(root, "public");
const file = (url: string) => path.join(publicDir, url);

async function pixel(png: string, x: number, y: number): Promise<string> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return `#${[0, 1, 2].map((i) => data[at + i]!.toString(16).padStart(2, "0")).join("")}`;
}

describe("the app's icons", () => {
  it("has every icon the manifest lists, as a PNG of the size it says", async () => {
    for (const icon of manifest().icons ?? []) {
      const meta = await sharp(file(icon.src)).metadata();
      expect([meta.format, `${meta.width}x${meta.height}`], icon.src).toEqual(["png", icon.sizes]);
    }
  });

  it("draws the maskable icon on the dark ground the manifest gives the splash screen", async () => {
    const maskable = (manifest().icons ?? []).find((i) => i.purpose === "maskable");
    expect(maskable).toBeTruthy();
    // A phone may crop it to a circle, so the corners are the ground and nothing else.
    expect(await pixel(file(maskable!.src), 0, 0)).toBe(spec.theme.dark);
    expect(await pixel(file(maskable!.src), 511, 511)).toBe(spec.theme.dark);
  });

  it("has what the page links: the favicon, which is a real .ico, the 192 icon and the apple-touch icon", async () => {
    const icons = appMetadata(spec).icons as { icon: Array<{ url: string }>; apple: string };
    for (const url of [...icons.icon.map((i) => i.url), icons.apple]) expect(fs.existsSync(file(url)), url).toBe(true);
    const ico = fs.readFileSync(file("/favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    const meta = await sharp(file(icons.apple)).metadata();
    expect([meta.width, meta.height]).toEqual([180, 180]);
  });
});

describe("the service worker and the paths a signed-out phone may fetch", () => {
  it("keeps the worker's caches apart from every other app's", async () => {
    expect(await worker().text()).toContain(`\`collectcollect-${spec.id}-shell-`);
  });

  it("names only paths the app serves: a public path nothing answers at is a hole with no door", () => {
    const exists = (relative: string) => fs.existsSync(path.join(root, relative));
    for (const pathname of DOMAIN_PUBLIC_PATHS) {
      const served =
        exists(`src/app${pathname}/page.tsx`) || exists(`src/app${pathname}/route.ts`) || exists(`public${pathname}`) || (pathname === "/manifest.webmanifest" && exists("src/app/manifest.ts"));
      expect(served, pathname).toBe(true);
    }
  });
});
