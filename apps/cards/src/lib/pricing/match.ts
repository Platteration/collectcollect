/** Small text-matching helpers shared by the providers. */

export function tokens(text: string | null | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[#'".,:;()\[\]\-_/]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Fraction of `needle` tokens that appear in `haystack`. */
export function tokenOverlap(needle: string | null | undefined, haystack: string | null | undefined): number {
  const n = tokens(needle);
  if (n.length === 0) return 0;
  const h = new Set(tokens(haystack));
  let hits = 0;
  for (const t of n) if (h.has(t)) hits++;
  return hits / n.length;
}

/** "4/102" -> "4", "LOB-001" -> "001", "US175" -> "US175", "#150" -> "150". */
export function numberPart(cardNumber: string | null | undefined): string | null {
  if (!cardNumber) return null;
  const trimmed = cardNumber.trim().replace(/^#/, "");
  const slash = (trimmed.split("/")[0] ?? "").trim();
  const dash = slash.includes("-") ? slash.split("-").pop()!.trim() : slash;
  return dash || null;
}

/** Strip leading zeros so "004" and "4" compare equal. */
export function normalizeNumber(n: string | null | undefined): string | null {
  const part = numberPart(n);
  if (!part) return null;
  const m = part.match(/^0*(\d+)([a-z]*)$/i);
  if (!m) return part.toLowerCase();
  const [, digits = "", suffix = ""] = m;
  return `${digits}${suffix.toLowerCase()}`;
}

export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeNumber(a);
  const nb = normalizeNumber(b);
  return Boolean(na && nb && na === nb);
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Symmetric similarity in [0, 1]: extra tokens on either side lower the score. */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  return (tokenOverlap(a, b) + tokenOverlap(b, a)) / 2;
}

const GENERIC_SET_WORDS = new Set(["set", "the", "of"]);

/** Set-name similarity ignoring filler words, so "Base Set" ≈ "Base" but < "Base Set 2". */
export function setSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const strip = (s: string | null | undefined) => tokens(s).filter((t) => !GENERIC_SET_WORDS.has(t)).join(" ");
  return similarity(strip(a), strip(b));
}
