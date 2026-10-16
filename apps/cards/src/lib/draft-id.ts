/**
 * A new scan draft's id, made in the browser before the photo is sent.
 *
 * The server accepts only a UUID (`validDraftId` in scan-drafts.ts), and
 * `crypto.randomUUID` exists only in a secure context: https, or localhost. A
 * phone that opens the app by its address on the home network, over plain http,
 * has no such function, so calling it threw inside the file input's change
 * handler and Choose photos did nothing, with no message. `getRandomValues`
 * has no such restriction, so it makes the same kind of id (version 4, variant
 * 10xx) from the browser's own random source when `randomUUID` is missing.
 */
type RandomSource = Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">>;

export function newDraftId(source: RandomSource = globalThis.crypto): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  // RFC 4122 §4.4: the high nibble of byte 6 is the version, the top two bits of byte 8 the variant.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
