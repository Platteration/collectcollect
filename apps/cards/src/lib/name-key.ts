/**
 * The normalised form of a card name, stored in `cards.name_key` and used to
 * find duplicates.
 *
 * One function defines the key, in JavaScript, because the two sides used to
 * disagree: the column was written as SQLite's `lower(trim(name))`, whose
 * `lower()` folds ASCII only and whose `trim()` strips spaces only, while the
 * lookup sent `name.trim().toLowerCase()`, which is Unicode-aware. "ÉLECTRODE"
 * was therefore stored as "Électrode" and looked up as "électrode", so the
 * duplicate was never found and a second card was created instead of merging —
 * a silent wrong answer rather than an error.
 *
 * NFKC first so that names typed with a composed and a decomposed accent, or
 * with full-width characters, land on the same key.
 */
export function nameKey(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}
