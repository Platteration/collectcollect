import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { openDatabase, setDb, uploadsDir } from "@/lib/db";
import { createCard } from "@/lib/cards";
import { saveUpload } from "@/lib/images";
import { sweepOrphanedUploads } from "@/lib/uploads";

let dir: string;
const previousDataDir = process.env.DATA_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-images-"));
  process.env.DATA_DIR = dir;
  setDb(openDatabase(":memory:"));
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

const png = () => sharp({ create: { width: 20, height: 30, channels: 3, background: "#c94f2b" } }).png().toBuffer();

const upload = (buffer: Buffer, type: string, name = "card.png") =>
  new File([new Uint8Array(buffer)], name, { type });

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>');

describe("saveUpload", () => {
  it("stores a real photo as a jpeg", async () => {
    const { name, bytes, color } = await saveUpload(upload(await png(), "image/png"));
    expect(name).toMatch(/^[a-f0-9-]{36}\.jpg$/);
    expect(bytes).toBeGreaterThan(0);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(fs.existsSync(path.join(uploadsDir(), name))).toBe(true);
  });

  it("accepts only the types on the allowlist, not any image/* the client declares", async () => {
    // An SVG is a document for a vector parser, not one of the raster formats
    // this app believes it accepts.
    await expect(saveUpload(upload(SVG, "image/svg+xml", "card.svg"))).rejects.toThrow(/Unsupported file type/);
    await expect(saveUpload(upload(await png(), "image/gif"))).rejects.toThrow(/Unsupported file type/);
    await expect(saveUpload(upload(await png(), ""))).rejects.toThrow(/Unsupported file type/);
  });

  it("is not fooled by a type named after something on Object.prototype", async () => {
    // A bare `ALLOWED_IMAGE_TYPES[file.type]` answered truthily for every
    // inherited name, so `Content-Type: constructor` walked past the allowlist
    // and handed an SVG to librsvg. The two messages say which gate refused it,
    // which is how the bypass shows.
    for (const type of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
      await expect(saveUpload(upload(SVG, type, "card.svg"))).rejects.toThrow(/Unsupported file type/);
    }
  });

  it("decides from the decoded bytes, not the declared type", async () => {
    await expect(saveUpload(upload(SVG, "image/png"))).rejects.toThrow(/not a JPEG, PNG, WebP or HEIC/);
    await expect(saveUpload(upload(Buffer.from("not an image at all"), "image/jpeg"))).rejects.toThrow(
      /not a JPEG, PNG, WebP or HEIC/,
    );
  });
});

describe("sweepOrphanedUploads", () => {
  const age = async (name: string, ms: number) => {
    const when = new Date(Date.now() - ms);
    await fsp.utimes(path.join(uploadsDir(), name), when, when);
  };

  it("removes old photos no card points at, and keeps the rest", async () => {
    const kept = await saveUpload(upload(await png(), "image/png"));
    const orphan = await saveUpload(upload(await png(), "image/png"));
    const recent = await saveUpload(upload(await png(), "image/png"));
    createCard({ game: "pokemon", name: "Charizard", imagePath: kept.name });

    // The card's photo and the orphan are both a week old; the third is new.
    await age(kept.name, 7 * 86400_000);
    await age(orphan.name, 7 * 86400_000);

    const result = await sweepOrphanedUploads();
    expect(result.removed).toBe(1);
    expect(result.bytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(uploadsDir(), kept.name))).toBe(true);
    expect(fs.existsSync(path.join(uploadsDir(), recent.name))).toBe(true);
    expect(fs.existsSync(path.join(uploadsDir(), orphan.name))).toBe(false);
  });

  it("leaves a photo that has not been attached to a card yet", async () => {
    // The add and scan screens upload first and save the card afterwards.
    const pending = await saveUpload(upload(await png(), "image/png"));
    expect((await sweepOrphanedUploads()).removed).toBe(0);
    expect(fs.existsSync(path.join(uploadsDir(), pending.name))).toBe(true);
  });

  it("never touches a file this app did not write", async () => {
    fs.writeFileSync(path.join(uploadsDir(), "notes.txt"), "mine");
    await fsp.utimes(path.join(uploadsDir(), "notes.txt"), new Date(0), new Date(0));
    expect((await sweepOrphanedUploads()).removed).toBe(0);
    expect(fs.existsSync(path.join(uploadsDir(), "notes.txt"))).toBe(true);
  });
});
