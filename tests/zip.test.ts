import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertZippable, crc32, zipStream } from "@/lib/zip";

async function build(entries: Array<{ name: string; body: Uint8Array; chunkSize?: number }>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const chunk of zipStream(
    entries.map((e) => ({
      name: e.name,
      size: e.body.length,
      chunks: function* () {
        const step = e.chunkSize ?? (e.body.length || 1);
        for (let i = 0; i < e.body.length; i += step) yield e.body.subarray(i, i + step);
      },
    })),
  )) {
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

describe("zip writer", () => {
  it("matches the reference CRC-32 of a known string", () => {
    // "123456789" has a documented CRC-32 of 0xCBF43926.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("produces an archive that real tools accept and read back byte for byte", async () => {
    const text = new TextEncoder().encode("hello, collection\n".repeat(50));
    const binary = new Uint8Array(5000).map((_, i) => (i * 31) % 256);
    const zip = await build([
      { name: "manifest.json", body: text },
      // fed in small pieces, to exercise the chunked path
      { name: "uploads/photo.jpg", body: binary, chunkSize: 512 },
    ]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-test-"));
    const file = path.join(dir, "out.zip");
    fs.writeFileSync(file, zip);

    // The system unzip verifies the CRCs and the central directory.
    expect(execFileSync("unzip", ["-t", file]).toString()).toMatch(/No errors detected/);

    execFileSync("unzip", ["-q", file, "-d", path.join(dir, "x")]);
    expect(fs.readFileSync(path.join(dir, "x", "manifest.json"))).toEqual(Buffer.from(text));
    expect(fs.readFileSync(path.join(dir, "x", "uploads", "photo.jpg"))).toEqual(Buffer.from(binary));

    // Python's reader independently confirms the entry table.
    const listed = execFileSync("python3", [
      "-c",
      `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() or "ok"); print(",".join(z.namelist()))`,
      file,
    ]).toString();
    expect(listed).toContain("ok");
    expect(listed).toContain("manifest.json,uploads/photo.jpg");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes a readable archive with no entries", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-empty-"));
    const file = path.join(dir, "empty.zip");
    fs.writeFileSync(file, await build([]));
    expect(
      execFileSync("python3", ["-c", `import zipfile,sys; print(len(zipfile.ZipFile(sys.argv[1]).namelist()))`, file]).toString().trim(),
    ).toBe("0");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses rather than writing an archive the format cannot address", () => {
    expect(() => assertZippable([{ name: "huge.bin", size: 5_000_000_000 }])).toThrow(/larger than 4 GB/);
    expect(() =>
      assertZippable(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, size: 1_000_000_000 }))),
    ).toThrow(/exceed 4 GB/);
  });

  it("notices a file that changes size while being read", async () => {
    await expect(
      build([]).then(() =>
        (async () => {
          for await (const _ of zipStream([{ name: "x", size: 10, chunks: () => [new Uint8Array(3)] }])) void _;
        })(),
      ),
    ).rejects.toThrow(/changed size/);
  });
});

describe("backup archive", () => {
  it("contains a working database copy and every photo", async () => {
    const { execFileSync } = await import("node:child_process");
    const fsm = await import("node:fs");
    const osm = await import("node:os");
    const pathm = await import("node:path");
    const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "cc-backup-"));
    process.env.DATA_DIR = dir;

    const { setDb, openDatabase, openLiveDatabase, uploadsDir } = await import("@/lib/db");
    const { createCard } = await import("@/lib/cards");
    setDb(openLiveDatabase(pathm.join(dir, "collectcollect.db")));
    createCard({ game: "pokemon", name: "Backed-up Charizard", setName: "Base Set" });
    fsm.writeFileSync(pathm.join(uploadsDir(), "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const { buildBackup } = await import("@/lib/backup");
    const { filename, stream } = await buildBackup();
    expect(filename).toMatch(/^collectcollect-backup-\d{4}-\d{2}-\d{2}\.zip$/);

    const parts: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) parts.push(chunk);
    const file = pathm.join(dir, "backup.zip");
    fsm.writeFileSync(file, Buffer.concat(parts));

    expect(execFileSync("unzip", ["-t", file]).toString()).toMatch(/No errors detected/);
    execFileSync("unzip", ["-q", file, "-d", pathm.join(dir, "out")]);
    expect(fsm.existsSync(pathm.join(dir, "out", "uploads", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg"))).toBe(true);
    expect(JSON.parse(fsm.readFileSync(pathm.join(dir, "out", "manifest.json"), "utf8")).photos).toBe(1);

    // The extracted database opens and still holds the card.
    const restored = openDatabase(pathm.join(dir, "out", "collectcollect.db"));
    expect((restored.prepare("SELECT name FROM cards").all() as Array<{ name: string }>)[0].name).toBe("Backed-up Charizard");

    delete process.env.DATA_DIR;
    fsm.rmSync(dir, { recursive: true, force: true });
  });
});

describe("zip reader", () => {
  it("reads archives written by the system zip tool, stored and deflated", async () => {
    const { execFileSync } = await import("node:child_process");
    const fsm = await import("node:fs");
    const osm = await import("node:os");
    const pathm = await import("node:path");
    const { readZip } = await import("@/lib/zip");
    const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "zip-read-"));
    fsm.mkdirSync(pathm.join(dir, "src", "uploads"), { recursive: true });
    const text = "collection\n".repeat(200);
    fsm.writeFileSync(pathm.join(dir, "src", "manifest.json"), text);
    fsm.writeFileSync(pathm.join(dir, "src", "uploads", "a.jpg"), Buffer.from([1, 2, 3, 4, 5]));

    for (const [label, flag] of [["deflated", "-r"], ["stored", "-0r"]] as const) {
      const file = pathm.join(dir, `${label}.zip`);
      execFileSync("zip", [flag, file, "."], { cwd: pathm.join(dir, "src") });
      const entries = await readZip(new Uint8Array(fsm.readFileSync(file)), { maxTotalBytes: 1e7, maxEntries: 100 });
      const manifest = entries.find((e) => e.name.endsWith("manifest.json"));
      expect(new TextDecoder().decode(manifest!.data), label).toBe(text);
      expect(entries.find((e) => e.name.endsWith("a.jpg"))!.data).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    }
    fsm.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses damaged, oversized and unrecognised files", async () => {
    const { readZip } = await import("@/lib/zip");
    const limits = { maxTotalBytes: 1e6, maxEntries: 10 };
    await expect(readZip(new Uint8Array([1, 2, 3]), limits)).rejects.toThrow(/not a zip archive/);

    const good = await (async () => {
      const parts: Uint8Array[] = [];
      const { zipStream } = await import("@/lib/zip");
      const body = new TextEncoder().encode("x".repeat(100));
      for await (const c of zipStream([{ name: "manifest.json", size: body.length, chunks: () => [body] }])) parts.push(c);
      return Buffer.concat(parts);
    })();
    // Corrupting a payload byte trips the checksum. The header is 30 bytes and
    // the name 13, so the payload starts at 43.
    const corruptPayload = new Uint8Array(good);
    corruptPayload[50] ^= 0xff;
    await expect(readZip(corruptPayload, limits)).rejects.toThrow(/failed its checksum/);
    // Renaming the entry in its local header, but not the directory, is caught.
    const renamed = new Uint8Array(good);
    renamed[31] = "X".charCodeAt(0);
    await expect(readZip(renamed, limits)).rejects.toThrow(/disagrees with its own header/);
    await expect(readZip(new Uint8Array(good), { maxTotalBytes: 10, maxEntries: 10 })).rejects.toThrow(/expands to more/);
    await expect(readZip(new Uint8Array(good), { maxTotalBytes: 1e6, maxEntries: 0 })).rejects.toThrow(/more than the 0 allowed/);
  });

  it("refuses to inflate past the allowed size, not merely to notice afterwards", async () => {
    const { execFileSync } = await import("node:child_process");
    const fsm = await import("node:fs");
    const osm = await import("node:os");
    const pathm = await import("node:path");
    const { readZip } = await import("@/lib/zip");
    const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "zip-bomb-"));
    // 32 MB of zeroes compresses to a few tens of kilobytes.
    fsm.writeFileSync(pathm.join(dir, "big.bin"), Buffer.alloc(32 * 1024 * 1024));
    const file = pathm.join(dir, "bomb.zip");
    execFileSync("zip", ["-q", "-9", file, "big.bin"], { cwd: dir });
    const archive = new Uint8Array(fsm.readFileSync(file));
    expect(archive.length).toBeLessThan(1024 * 1024);
    await expect(readZip(archive, { maxTotalBytes: 1_000_000, maxEntries: 10 })).rejects.toThrow(/expands to more/);
    fsm.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects entry names that would escape the target directory", async () => {
    const { isSafeEntryName } = await import("@/lib/zip");
    expect(isSafeEntryName("uploads/a.jpg")).toBe(true);
    expect(isSafeEntryName("collectcollect.db")).toBe(true);
    for (const bad of ["../escape", "uploads/../../etc/passwd", "/etc/passwd", "C:\\windows", "uploads\\a.jpg", "", "./x", "a//b", "a\0b"]) {
      expect(isSafeEntryName(bad), bad).toBe(false);
    }
  });
});

describe("restore", () => {
  it("round-trips a collection and keeps the replaced one", async () => {
    const fsm = await import("node:fs");
    const osm = await import("node:os");
    const pathm = await import("node:path");
    const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "cc-restore-"));
    process.env.DATA_DIR = dir;

    const { setDb, openLiveDatabase, uploadsDir } = await import("@/lib/db");
    const { createCard, listCards } = await import("@/lib/cards");
    const { buildBackup, restoreBackup } = await import("@/lib/backup");
    setDb(openLiveDatabase(pathm.join(dir, "collectcollect.db")));
    createCard({ game: "pokemon", name: "Original Charizard" });
    fsm.writeFileSync(pathm.join(uploadsDir(), "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg"), Buffer.from([9, 9, 9]));

    const { stream } = await buildBackup();
    const parts: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) parts.push(chunk);
    const archive = Buffer.concat(parts);

    // Change the collection, then put the backup back over it.
    createCard({ game: "mtg", name: "Added After The Backup" });
    expect(listCards()).toHaveLength(2);

    const result = await restoreBackup(new Uint8Array(archive));
    expect(result).toMatchObject({ photos: 1, cards: 1 });
    expect(listCards().map((c) => c.name)).toEqual(["Original Charizard"]);
    expect(fsm.existsSync(pathm.join(uploadsDir(), "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg"))).toBe(true);
    // The replaced collection is kept rather than deleted.
    expect(fsm.existsSync(pathm.join(result.movedAsideTo, "collectcollect.db"))).toBe(true);

    delete process.env.DATA_DIR;
    fsm.rmSync(dir, { recursive: true, force: true });
  });

  it("replaces the database the app is actually using, not just the default path", async () => {
    const fsm = await import("node:fs");
    const osm = await import("node:os");
    const pathm = await import("node:path");
    const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "cc-dbfile-"));
    const custom = pathm.join(dir, "elsewhere.db");
    process.env.DATA_DIR = dir;
    process.env.DATABASE_FILE = custom;

    const { setDb, openLiveDatabase } = await import("@/lib/db");
    const { createCard, listCards } = await import("@/lib/cards");
    const { buildBackup, restoreBackup } = await import("@/lib/backup");
    setDb(openLiveDatabase(custom));
    createCard({ game: "pokemon", name: "In The Custom File" });

    const { stream } = await buildBackup();
    const parts: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) parts.push(chunk);

    createCard({ game: "mtg", name: "Added Later" });
    expect(listCards()).toHaveLength(2);

    await restoreBackup(new Uint8Array(Buffer.concat(parts)));
    // The live database really was replaced, so the later card is gone.
    expect(listCards().map((c) => c.name)).toEqual(["In The Custom File"]);

    delete process.env.DATABASE_FILE;
    delete process.env.DATA_DIR;
    setDb(undefined);
    fsm.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses an archive that is not one of its own backups", async () => {
    const fsm = await import("node:fs");
    const osm = await import("node:os");
    const pathm = await import("node:path");
    const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "cc-restore-bad-"));
    process.env.DATA_DIR = dir;
    const { setDb, openLiveDatabase } = await import("@/lib/db");
    const { restoreBackup } = await import("@/lib/backup");
    const { zipStream } = await import("@/lib/zip");
    setDb(openLiveDatabase(pathm.join(dir, "collectcollect.db")));

    const build = async (name: string, body: Uint8Array) => {
      const parts: Uint8Array[] = [];
      for await (const c of zipStream([{ name, size: body.length, chunks: () => [body] }])) parts.push(c);
      return new Uint8Array(Buffer.concat(parts));
    };

    await expect(restoreBackup(await build("notes.txt", new Uint8Array([1])))).rejects.toThrow(/did not write/);
    await expect(restoreBackup(await build("manifest.json", new Uint8Array([1])))).rejects.toThrow(/no collectcollect.db/);
    await expect(restoreBackup(await build("uploads/evil.sh", new Uint8Array([1])))).rejects.toThrow(/unexpected photo name/);
    await expect(restoreBackup(await build("collectcollect.db", new TextEncoder().encode("not a database")))).rejects.toThrow(/could not be opened/);
    // The collection is untouched after every refusal.
    expect(fsm.existsSync(pathm.join(dir, "collectcollect.db"))).toBe(true);
    expect(fsm.readdirSync(dir).filter((n) => n.startsWith("replaced-"))).toHaveLength(0);

    delete process.env.DATA_DIR;
    fsm.rmSync(dir, { recursive: true, force: true });
  });
});
