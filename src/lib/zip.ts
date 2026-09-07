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

export function assertZippable(entries: Array<{ name: string; size: number }>): void {
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
