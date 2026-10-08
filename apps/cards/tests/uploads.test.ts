import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb, uploadsDir } from "@/lib/db";
import { createCard } from "@/lib/cards";
import { saveUpload, thumbName } from "@/lib/images";
import { createScanDraft } from "@/lib/scan-drafts";
import { sweepOrphanedUploads } from "@/lib/uploads";
import { archiveGate } from "@/lib/storage";

// tests/setup.ts gives every test a fresh DATA_DIR.
beforeEach(() => setDb(openDatabase(":memory:")));

const png = () => sharp({ create: { width: 20, height: 30, channels: 3, background: "#c94f2b" } }).png().toBuffer();
const photo = async () => saveUpload(new File([new Uint8Array(await png())], "card.png", { type: "image/png" }));
const age = async (name: string, ms: number) => {
  const when = new Date(Date.now() - ms);
  await fsp.utimes(path.join(uploadsDir(), name), when, when);
};
const present = (name: string) => fs.existsSync(path.join(uploadsDir(), name));
const WEEK = 7 * 86400_000;

describe("photos nothing points at", () => {
  it("are removed once old, with their small copies, and everything claimed stays", async () => {
    const kept = await photo();
    const drafted = await photo();
    const orphan = await photo();
    const recent = await photo();
    createCard({ game: "pokemon", name: "Charizard", imagePath: kept.name });
    createScanDraft(crypto.randomUUID(), drafted);
    for (const p of [kept, drafted, orphan]) await age(p.name, WEEK);

    const result = await sweepOrphanedUploads();
    expect(result.removed).toBe(1);
    expect(result.bytes).toBeGreaterThan(0);
    expect(present(orphan.name)).toBe(false);
    expect(present(thumbName(orphan.name))).toBe(false);
    // A card's photo, a scan's photo, and one too new to have been claimed yet.
    for (const p of [kept, drafted, recent]) expect(present(p.name)).toBe(true);
  });

  it("leaves a photo that has not been attached to a card yet", async () => {
    // The add screen uploads first and saves the card afterwards.
    const pending = await photo();
    expect((await sweepOrphanedUploads()).removed).toBe(0);
    expect(present(pending.name)).toBe(true);
  });

  it("never touches a file this app did not write", async () => {
    fs.writeFileSync(path.join(uploadsDir(), "notes.txt"), "mine");
    await fsp.utimes(path.join(uploadsDir(), "notes.txt"), new Date(0), new Date(0));
    expect((await sweepOrphanedUploads()).removed).toBe(0);
    expect(present("notes.txt")).toBe(true);
  });

  it("deletes nothing when it cannot read what a scan holds", async () => {
    const orphan = await photo();
    await age(orphan.name, WEEK);
    getDb().prepare("INSERT INTO scan_drafts (id, uploads, created_at, updated_at) VALUES (?, ?, 't', 't')").run(crypto.randomUUID(), "{");
    expect((await sweepOrphanedUploads()).removed).toBe(0);
    expect(present(orphan.name)).toBe(true);
  });

  it("waits while a backup or a restore holds the uploads", async () => {
    const orphan = await photo();
    await age(orphan.name, WEEK);
    let release!: () => void;
    const held = archiveGate.run(() => new Promise<void>((resolve) => (release = resolve)));
    await expect(sweepOrphanedUploads()).rejects.toThrow(/already running/);
    expect(present(orphan.name)).toBe(true);
    release();
    await held;
    expect((await sweepOrphanedUploads()).removed).toBe(1);
  });
});
