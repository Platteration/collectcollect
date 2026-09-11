import { EXTERIOR_IDS, type Category, type Exterior } from "./types";
import { lookup } from "@collectcollect/core/lookup";

/**
 * What a market hash name tells you on its own.
 *
 * Steam's naming is regular enough to lean on, and it carries more than it
 * looks: whether an item is StatTrak, whether it is Souvenir, which wear tier
 * it is in, and usually what kind of thing it is. Reading it saves the owner
 * typing what the name already says.
 *
 * This module touches nothing else on purpose. The add form runs it in the
 * browser as someone types, and anything reaching the repository from here
 * would drag the database driver into the client bundle.
 */

export const EXTERIOR_ALIASES: Record<string, Exterior> = {
  fn: "factory_new",
  factorynew: "factory_new",
  mw: "minimal_wear",
  minimalwear: "minimal_wear",
  ft: "field_tested",
  fieldtested: "field_tested",
  ww: "well_worn",
  wellworn: "well_worn",
  bs: "battle_scarred",
  battlescarred: "battle_scarred",
};

/** The wear tier printed in brackets at the end of a market hash name. */
export function exteriorFromName(name: string): Exterior | null {
  const match = /\(([^)]+)\)\s*$/.exec(name);
  if (!match) return null;
  const printed = match[1].toLowerCase().replace(/[^a-z]/g, "");
  return lookup(EXTERIOR_ALIASES, printed) ?? EXTERIOR_IDS.find((id) => id.replace(/_/g, "") === printed) ?? null;
}

/**
 * What kind of item a market hash name describes.
 *
 * A knife or a pair of gloves carries a star, a sticker or a capsule says so,
 * and anything with a wear tier in brackets is something you can hold. Where
 * the name gives nothing away the answer is null rather than a guess.
 */
export function guessCategory(name: string): Category | null {
  const text = name.toLowerCase();
  if (name.startsWith("★")) return /glove|wraps|hand wraps/.test(text) ? "glove" : "knife";
  if (text.startsWith("sticker |")) return "sticker";
  if (text.startsWith("patch |")) return "patch";
  if (text.startsWith("sealed graffiti") || text.startsWith("graffiti |")) return "graffiti";
  if (text.startsWith("music kit")) return "music_kit";
  if (text.startsWith("charm |")) return "charm";
  if (text.includes("capsule")) return "capsule";
  if (text.includes("case key")) return "key";
  if (text.includes(" case") || text.endsWith("case") || text.includes("souvenir package")) return "case";
  if (text.includes("pin")) return "pin";
  if (text.includes("pass")) return "pass";
  // A wear tier in brackets means a thing that gets worn, which is a weapon
  // unless the star above already said otherwise.
  return exteriorFromName(name) ? "weapon" : null;
}

/** "StatTrak™ AK-47 | Redline (Field-Tested)" split into the gun and the finish. */
export function splitName(name: string): { weapon: string | null; finish: string | null } {
  const withoutWear = name.replace(/\s*\([^)]*\)\s*$/, "");
  const bar = withoutWear.indexOf("|");
  if (bar === -1) return { weapon: null, finish: null };
  const weapon = withoutWear
    .slice(0, bar)
    .replace(/^★\s*/, "")
    .replace(/^StatTrak™\s*/i, "")
    .replace(/^Souvenir\s*/i, "")
    .trim();
  return { weapon: weapon || null, finish: withoutWear.slice(bar + 1).trim() || null };
}

export function isStatTrakName(name: string): boolean {
  return /StatTrak/i.test(name);
}

export function isSouvenirName(name: string): boolean {
  return /^Souvenir\b/i.test(name);
}
