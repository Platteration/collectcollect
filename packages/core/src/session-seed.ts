import fs from "node:fs";
import path from "node:path";

/**
 * A random key for signing sessions, kept in one small file beside the data.
 *
 * Deriving the key from the password keeps setup to one variable, but a
 * captured cookie is then a known plaintext (its own expiry) signed with a key
 * made of the password: an offline password-guessing oracle with no rate limit
 * at all. A random 256-bit seed removes that. The password is still mixed into
 * every token by the caller, so changing it still ends every session.
 *
 * Read the way the revocation list is (node:fs, re-read when the file has
 * changed), so it runs wherever the proxy does. Created on first use with an
 * exclusive write: two workers racing on first boot cannot each install a key
 * and refuse the other's sessions. Null when there is nowhere to keep one — a
 * read-only data directory — which the caller treats as "fall back, and say so".
 */
export function createSessionSeed(file: string | (() => string)): () => string | null {
  const where = typeof file === "string" ? () => file : file;
  let cached: { path: string; mtimeMs: number; size: number; seed: string } | null = null;

  function read(target: string): string | null {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(/* turbopackIgnore: true */ target);
    } catch {
      return null;
    }
    if (cached && cached.path === target && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.seed;
    let seed: string;
    try {
      seed = fs.readFileSync(/* turbopackIgnore: true */ target, "utf8").trim();
    } catch {
      return null;
    }
    if (!seed) return null;
    cached = { path: target, mtimeMs: stat.mtimeMs, size: stat.size, seed };
    return seed;
  }

  return () => {
    const target = where();
    const existing = read(target);
    if (existing) return existing;
    try {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const fresh = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
      // `wx` fails rather than overwriting, and 0600 because it is a key.
      fs.writeFileSync(/* turbopackIgnore: true */ target, `${fresh}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch {
      // Lost the race to another worker, or the directory is read-only: what
      // is there now is the answer, and nothing being there is an answer too.
    }
    return read(target);
  };
}
