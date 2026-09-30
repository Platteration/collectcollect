import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb, uploadsDir } from "@/lib/db";
import { backupSummary } from "@/lib/backup";

beforeEach(() => setDb(openDatabase(":memory:")));

describe("what a backup would hold", () => {
  it("is measured once per state of the photo folder, not once per render", () => {
    const first = path.join(uploadsDir(), "11111111-1111-1111-1111-111111111111.jpg");
    fs.writeFileSync(first, Buffer.alloc(10));
    expect(backupSummary()).toMatchObject({ photos: 1, photoBytes: 10 });
    // Rewritten in place, which no upload ever is: the folder's own listing
    // has not changed, so the tally is the one already taken.
    fs.writeFileSync(first, Buffer.alloc(50));
    expect(backupSummary()).toMatchObject({ photos: 1, photoBytes: 10 });
    // A new photo changes the folder, and everything is counted again.
    fs.writeFileSync(path.join(uploadsDir(), "22222222-2222-2222-2222-222222222222.jpg"), Buffer.alloc(5));
    expect(backupSummary()).toMatchObject({ photos: 2, photoBytes: 55 });
    // The small copies beside photos are not photos.
    fs.writeFileSync(path.join(uploadsDir(), "22222222-2222-2222-2222-222222222222.thumb.jpg"), Buffer.alloc(1));
    expect(backupSummary()).toMatchObject({ photos: 2, photoBytes: 55 });
  });
});
