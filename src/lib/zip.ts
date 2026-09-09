/**
 * A minimal ZIP writer, stored (uncompressed) entries only. Photos are already
 * JPEG so compressing them again buys almost nothing, and this keeps the
 * archive dependency-free and easy to reason about.
 *
 * Entries are streamed, so a large collection of photos never has to fit in
 * memory. The classic 32-bit format is used, which caps the archive and any
 * single file at 4 GB; `assertZippable` refuses anything larger rather than
 * writing a file that silently truncates.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

export const ZIP_MAX_BYTES = 0xffffffff;

export interface ZipEntry {
  name: string;
  size: number;
  /** Bytes of the entry, in order. */
  chunks: () => AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

/** The end-of-central-directory record counts entries in 16 bits. */
export const ZIP_MAX_ENTRIES = 0xffff;

/**
 * Read a file in pieces, for use as a zip entry's `chunks`. Entries built this
 * way never hold their file in memory, however many of them an archive has.
 */
export async function* fileChunks(file: string): AsyncGenerator<Uint8Array> {
  const { open } = await import("node:fs/promises");
  const handle = await open(file, "r");
  try {
    const buffer = new Uint8Array(64 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) return;
      yield buffer.slice(0, bytesRead);
    }
  } finally {
    await handle.close();
  }
}

export function assertZippable(entries: Array<{ name: string; size: number }>): void {
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`An archive can hold ${ZIP_MAX_ENTRIES} files and this would have ${entries.length}. Copy the data directory instead.`);
  }
  let total = 0;
  for (const e of entries) {
    if (e.size > ZIP_MAX_BYTES) throw new Error(`${e.name} is larger than 4 GB, which this archive format cannot hold`);
    total += e.size + 100; // headers add a little per entry
  }
  if (total > ZIP_MAX_BYTES) throw new Error("The backup would exceed 4 GB. Copy the data directory instead.");
}

/** MS-DOS date and time, which is what the format stores. */
function dosDateTime(d: Date): { date: number; time: number } {
  return {
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

export async function* zipStream(entries: ZipEntry[], now = new Date()): AsyncGenerator<Uint8Array> {
  assertZippable(entries);
  const { date, time } = dosDateTime(now);
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    // CRC and sizes are known up front because the caller supplies the size.
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    // The local header carries the CRC, which is only known once the whole
    // entry has been read, so one entry at a time is buffered. Entries are
    // still emitted as they are finished, so the full archive never has to fit
    // in memory, only its largest single file.
    const parts: Uint8Array[] = [];
    let written = 0;
    for await (const chunk of entry.chunks()) {
      parts.push(chunk);
      written += chunk.length;
    }
    if (written !== entry.size) throw new Error(`${entry.name} changed size while being archived`);
    const whole = concat(parts, written);
    const crc = crc32(whole);

    local.setUint32(14, crc, true);
    local.setUint32(18, written, true);
    local.setUint32(22, written, true);

    yield new Uint8Array(local.buffer);
    yield nameBytes;
    yield whole;

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // central directory header
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, written, true);
    cd.setUint32(24, written, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += 30 + nameBytes.length + written;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  for (const c of central) yield c;

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  yield new Uint8Array(end.buffer);
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ReadEntry {
  name: string;
  data: Uint8Array;
}

/** Total uncompressed bytes a caller is willing to extract, so a small archive cannot expand without bound. */
export interface ReadLimits {
  maxTotalBytes: number;
  maxEntries: number;
}

/**
 * Read a ZIP produced by this writer or by any ordinary tool: stored and
 * deflated entries, read through the central directory rather than by scanning
 * for local headers, so a truncated or doctored archive is rejected instead of
 * partly trusted.
 */
export async function readZip(buffer: Uint8Array, limits: ReadLimits): Promise<ReadEntry[]> {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const eocd = findEndOfCentralDirectory(buffer, view);
  const count = view.getUint16(eocd + 10, true);
  if (count > limits.maxEntries) throw new Error(`Archive holds ${count} entries, more than the ${limits.maxEntries} allowed`);
  let offset = view.getUint32(eocd + 16, true);

  const entries: ReadEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("The archive's directory is damaged");
    }
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(buffer.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    // Directory markers carry no data.
    if (name.endsWith("/")) continue;

    // Budget against the declared size first, then hand the remaining budget to
    // the decompressor, so a small archive claiming to be small cannot inflate
    // to gigabytes in memory before anyone checks.
    total += uncompressedSize;
    if (total > limits.maxTotalBytes) throw new Error("The archive expands to more than the allowed size");
    const remaining = limits.maxTotalBytes - (total - uncompressedSize);

    if (localOffset + 30 > buffer.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Entry ${name} does not point at a valid header`);
    }
    // The local header's own name and extra lengths decide where data starts.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localName = new TextDecoder().decode(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    // The directory is authoritative for the name, so a local header claiming a
    // different one means the archive has been doctored.
    if (localName !== name) throw new Error(`Entry ${name} disagrees with its own header`);
    const dataStart = localOffset + 30 + localNameLength + view.getUint16(localOffset + 28, true);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (raw.length !== compressedSize) throw new Error(`Entry ${name} is truncated`);

    let data: Uint8Array;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      const { inflateRaw } = await import("node:zlib");
      data = await new Promise<Uint8Array>((resolve, reject) =>
        inflateRaw(raw, { maxOutputLength: Math.min(remaining, uncompressedSize) + 1 }, (err, out) =>
          err ? reject(new Error(`Entry ${name} could not be decompressed within its declared size`)) : resolve(new Uint8Array(out)),
        ),
      );
    } else {
      throw new Error(`Entry ${name} uses an unsupported compression method`);
    }
    if (data.length !== uncompressedSize) throw new Error(`Entry ${name} is not the size its directory claims`);
    if (crc32(data) !== crc) throw new Error(`Entry ${name} failed its checksum`);
    entries.push({ name, data });
  }
  return entries;
}

function findEndOfCentralDirectory(buffer: Uint8Array, view: DataView): number {
  // The record sits at the end, after a comment of up to 64 KB.
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("That file is not a zip archive");
}

/**
 * Names inside an archive are attacker-controlled: refuse anything absolute,
 * containing a parent segment, or using a backslash that some tools treat as a
 * separator, so extraction cannot escape its directory.
 */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.length > 255 || name.includes("\\") || name.includes("\0")) return false;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split("/").some((part) => part === ".." || part === "." || part === "");
}
