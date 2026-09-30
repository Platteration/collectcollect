import type { Condition } from "./types";

/**
 * What a card's grade implies about its surface — corner and edge wear,
 * scratches, creases, dust, fingerprints, print lines, dents, stains,
 * yellowing, and on a foil, peeling — and which holo pattern it shows. The
 * grade decides how much wear there is and how likely each kind is; a hash
 * of the card's id decides which kinds it actually has and where, so the
 * same card always looks the same and two cards of one grade do not.
 * Everything here is geometry for `Card3D`; nothing touches the database.
 */

/** The condition the vision model read from the photo, when it left one. */
export interface Assessment {
  centering?: string | null;
  corners?: string | null;
  edges?: string | null;
  surface?: string | null;
}

/** The surface a card was printed with, where it has one worth drawing. */
export type Finish = "holo" | "reverse" | "foil" | "refractor";

/**
 * A card's finish, read from what the collection already records: the
 * printing variant ("reverse holo", "etched foil", "gold refractor") and,
 * failing that, the rarity ("Holo Rare"). Rarity alone never says reverse,
 * and a rarity like "Mythic" or "Ultra Rare" says nothing about foil.
 */
export function finishOf({ variant, rarity }: { variant?: string | null; rarity?: string | null }): Finish | null {
  const read = (text: string | null | undefined, allowReverse: boolean): Finish | null => {
    if (!text) return null;
    if (allowReverse && /reverse/i.test(text)) return "reverse";
    if (/refractor|prizm|chrome/i.test(text)) return "refractor";
    if (/holo/i.test(text)) return "holo";
    if (/foil|etched/i.test(text)) return "foil";
    return null;
  };
  return read(variant, true) ?? read(rarity, false);
}

export interface WearProfile {
  /** The 1–10 number the marks were drawn from. */
  grade: number;
  /** 0 at a perfect 10, 1 at a 1. */
  wear: number;
  /** How much the surface still shines: 1 pristine, 0.2 matte. */
  gloss: number;
  /** How far the print sits off centre, in percent of the card. */
  centering: { dx: number; dy: number };
  /** 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left; size 0–1. */
  corners: Array<{ corner: 0 | 1 | 2 | 3; size: number }>;
  /** 0 top, 1 right, 2 bottom, 3 left; start and length are fractions of the side. */
  edges: Array<{ side: 0 | 1 | 2 | 3; start: number; length: number; strength: number }>;
  /** In a 100 × 140 space, kept out of the middle so the art stays readable. */
  scratches: Array<{ x1: number; y1: number; x2: number; y2: number; opacity: number }>;
  /** Folds across a corner; only a heavily played card has any. */
  creases: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** Specks anywhere on the surface; some light, some dark. */
  dust: Array<{ x: number; y: number; r: number; dark: boolean }>;
  /** Fingerprints: soft ovals, kept off the art like scratches are. */
  smudges: Array<{ x: number; y: number; rx: number; ry: number; angle: number; opacity: number }>;
  /** A factory defect: one faint line the full width of the card. */
  printLines: Array<{ y: number; opacity: number }>;
  /** Small dings pressed into the surface. */
  dents: Array<{ x: number; y: number; r: number }>;
  /** Blotches near an edge; only a heavily played card has any. */
  stains: Array<{ x: number; y: number; rx: number; ry: number; angle: number; opacity: number }>;
  /** Age yellowing over the whole card, 0 none to about 0.35. */
  toning: number;
  /** Foil lifting away at a corner; only a finished card has any. */
  peels: Array<{ corner: 0 | 1 | 2 | 3; size: number }>;
  /** Worn edges on a finished card show the foil: drawn silver, not white. */
  silvering: boolean;
  /** How far a raw card has curled, and along which axis; a slab holds it flat. */
  warp: { axis: "x" | "y"; degrees: number };
  /** Every mark above (toning, silvering and warp aside), for tests and a data attribute. */
  count: number;
}

const CONDITION_GRADE: Record<Condition, number> = { NM: 9, LP: 7, MP: 5, HP: 3, DMG: 1.5 };

/**
 * The number a grade string carries — "10", "9.5", "PSA 10", "BGS 9.5 Black
 * Label" — as a 1–10 value. The last number in the string is the grade, so
 * "1st Edition 9" reads as a 9. "Authentic" is a slab with no grade, shown
 * as a mid card. A raw card, or a grade nothing can be read from, falls
 * back to its condition.
 */
export function gradeValue(grade: string | null | undefined, condition: Condition): number {
  const text = (grade ?? "").trim();
  if (text) {
    const numbers = text.match(/\d+(?:\.\d+)?/g);
    const last = numbers?.[numbers.length - 1];
    if (last !== undefined) {
      const n = Number(last);
      if (Number.isFinite(n) && n > 0) return Math.min(10, Math.max(1, n));
    } else if (/^auth/i.test(text) || /^a$/i.test(text)) {
      return 6;
    }
  }
  return CONDITION_GRADE[condition];
}

/** Small, fast, and the same sequence for the same seed on every platform. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A 32-bit hash of named parts: FNV-1a over the parts, finished with
 * murmur3's mixer so neighbouring ids land far apart. Every random choice a
 * card's look makes is a hash of its seed and the choice's name, so one
 * choice never shifts another: a card's second scratch is in the same place
 * however many specks of dust it has.
 */
export function hash32(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  const text = parts.join("\u001f");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A hash as a number in [0, 1). */
export function unit(...parts: Array<string | number>): number {
  return hash32(...parts) / 4294967296;
}

/** Pick one key by weight, using a number in [0, 1); null when every weight is zero. */
function pick<K extends string>(weights: Record<K, number>, u: number): K | null {
  const entries = (Object.entries(weights) as Array<[K, number]>).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return null;
  let at = u * total;
  for (const [key, w] of entries) {
    if (at < w) return key;
    at -= w;
  }
  return entries[entries.length - 1]![0];
}

const mentions = (text: string | null | undefined, words: RegExp) => Boolean(text && words.test(text));

/** The art sits roughly in this box of the 100 × 140 card; scratches stay out of it. */
const ART = { x1: 28, y1: 34, x2: 72, y2: 104 };
const inArt = (x: number, y: number) => x > ART.x1 && x < ART.x2 && y > ART.y1 && y < ART.y2;

/** Every kind of mark a card can carry, which the grade weights and the seed draws from. */
export const MARK_KINDS = ["dust", "smudge", "printLine", "corner", "edge", "scratch", "dent", "stain", "crease", "peel"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

/** How many of one kind a card can physically carry. */
const CAP: Partial<Record<MarkKind, number>> = { corner: 4, peel: 2, crease: 2, printLine: 3 };

/**
 * How likely each kind of mark is at a grade. `w` is 0 at a 10 and 1 at a 1;
 * a kind that does not belong at a grade — a stain on a near-mint card, a
 * crease on anything better than a 3 — has no weight there at all.
 */
export function markWeights(g: number, finish: Finish | null): Record<MarkKind, number> {
  const w = (10 - g) / 9;
  return {
    dust: 6 - 3 * w,
    smudge: 1 + 3 * w,
    printLine: g <= 8.5 ? 0.8 : 0,
    corner: 1 + 3 * w,
    edge: 0.5 + 4 * w,
    scratch: g <= 8.5 ? 4 * w : 0,
    dent: g <= 7 ? 3 * w : 0,
    stain: g <= 5 ? 3 * w * w : 0,
    crease: g <= 3 ? 2 * w : 0,
    peel: finish && g <= 5 ? 2 * w : 0,
  };
}

/** How many marks a card carries in all: the grade's alone, so a lower grade never has fewer. */
export function markBudget(g: number): number {
  return g >= 9.5 ? 0 : Math.round(3 + ((10 - g) / 9) * 37);
}

/** The finish a holo card's foil was printed with, drawn by weight like the wear. */
export type HoloPattern = "sheen" | "stripes" | "cosmos" | "cracked-ice" | "starlight";

/** [weight at a 10, weight at a 1]; the weight in between follows the grade. */
const PATTERN_WEIGHTS: Record<HoloPattern, [number, number]> = {
  sheen: [1, 6],
  stripes: [2, 3],
  cosmos: [3, 1.5],
  "cracked-ice": [3, 0.5],
  starlight: [3, 0.5],
};

/**
 * Which holo pattern a finished card shows. The fancier patterns are the
 * likelier on a better-graded card, the plain sheen on a played one; which
 * one a given card gets is a hash of its seed, so it never changes.
 */
export function holoPattern({ seed, grade, finish }: { seed: number; grade: number; finish: Finish | null }): HoloPattern | null {
  if (!finish) return null;
  const w = (10 - Math.min(10, Math.max(1, grade))) / 9;
  const weights = Object.fromEntries(
    (Object.entries(PATTERN_WEIGHTS) as Array<[HoloPattern, [number, number]]>).map(([k, [top, bottom]]) => [k, top + (bottom - top) * w]),
  ) as Record<HoloPattern, number>;
  return pick(weights, unit(seed, "pattern")) ?? "sheen";
}

export function wearProfile({
  seed,
  grade,
  assessment,
  finish = null,
  graded = false,
}: {
  seed: number;
  grade: number;
  assessment?: Assessment | null;
  finish?: Finish | null;
  /** Sealed in a slab, which holds a card flat. */
  graded?: boolean;
}): WearProfile {
  const g = Math.min(10, Math.max(1, grade));
  const wear = (10 - g) / 9;
  const id = Math.round(seed) || 1;
  const pristine = g >= 9.5;

  // The grade says how likely each kind is on cards in general; this card's
  // own leaning, a hash of its id, scales that, so one played card is mostly
  // scuffed and dented and another mostly stained. The leaning averages 1
  // (the square of an exponential, halved), so across a collection the
  // grade's weights still hold; the small floor keeps every kind possible.
  const weights = markWeights(g, finish);
  for (const kind of MARK_KINDS) {
    const x = -Math.log(1 - unit(id, "affinity", kind));
    weights[kind] *= Math.max(0.02, (x * x) / 2);
  }

  // What the photo showed makes a kind likelier; it never gives a gem-mint
  // card wear, because the budget already settled that it has none.
  let toningFloor = 0;
  let centeringScale = pristine ? 0 : wear * 4;
  if (!pristine && assessment) {
    const boost = (kind: MarkKind) => (weights[kind] *= 3);
    if (mentions(assessment.corners, /soft|round|worn|whit|ding|fray|bent/i)) boost("corner");
    if (mentions(assessment.edges, /whit|chip|wear|rough|nick|fray/i)) boost("edge");
    if (mentions(assessment.surface, /scratch|scuff|crease|wear|scuf/i)) boost("scratch");
    if (mentions(assessment.surface, /smudge|fingerprint|print\b|grease|oil/i)) boost("smudge");
    if (mentions(assessment.surface, /dust|speck|debris|particle/i)) boost("dust");
    if (mentions(assessment.surface, /print line|printing line|roller/i)) boost("printLine");
    if (mentions(assessment.surface, /stain|discolo|yellow|toning|toned|foxing|tan/i)) {
      boost("stain");
      toningFloor = 0.12;
    }
    if (mentions(assessment.centering, /off|oc\b|\d{2}\s*\/\s*\d{2}|left|right|high|low/i) && !mentions(assessment.centering, /well|good|centered|50\s*\/\s*50/i)) {
      centeringScale = Math.max(1, centeringScale * 1.5);
    }
  }

  // How many of each kind: first what defines the grade (a 2 or worse is
  // creased; a worn foil that bad has lifted), then the rest of the budget,
  // each mark's kind drawn by weight from those not already at their cap.
  const counts = Object.fromEntries(MARK_KINDS.map((k) => [k, 0])) as Record<MarkKind, number>;
  let budget = markBudget(g);
  const take = (kind: MarkKind) => {
    counts[kind] += 1;
    budget -= 1;
  };
  if (budget > 0 && g <= 2) take("crease");
  if (budget > 0 && g <= 2 && finish) take("peel");
  for (let slot = 0; budget > 0; slot++) {
    const open = { ...weights };
    for (const k of MARK_KINDS) if (CAP[k] !== undefined && counts[k] >= CAP[k]!) open[k] = 0;
    const kind = pick(open, unit(id, "kind", slot));
    if (!kind) break;
    take(kind);
  }

  // Each mark's shape comes from its own generator, named by its kind and index.
  const mark = (kind: string, index: number) => {
    const rand = mulberry32(hash32(id, kind, index));
    return { rand, between: (lo: number, hi: number) => lo + rand() * (hi - lo) };
  };

  const centering = centeringScale
    ? { dx: (unit(id, "centering", "x") * 2 - 1) * centeringScale, dy: (unit(id, "centering", "y") * 2 - 1) * centeringScale }
    : { dx: 0, dy: 0 };

  /** The four corners in the order this card wears them. */
  const cornerOrder = (name: string) => ([0, 1, 2, 3] as const).map((c) => ({ c, k: unit(id, name, c) })).sort((a, b) => a.k - b.k).map(({ c }) => c);

  const corners = cornerOrder("corner-order")
    .slice(0, counts.corner)
    .map((corner, i) => ({ corner, size: mark("corner", i).between(0.3, 0.6) + wear * 0.4 }));

  const edges: WearProfile["edges"] = [];
  for (let i = 0; i < counts.edge; i++) {
    const { rand, between } = mark("edge", i);
    const side = Math.floor(rand() * 4) as 0 | 1 | 2 | 3;
    const length = between(0.08, 0.2) + wear * 0.15;
    edges.push({ side, start: between(0, 1 - length), length, strength: between(0.3, 0.6) + wear * 0.3 });
  }

  const scratches: WearProfile["scratches"] = [];
  for (let i = 0; i < counts.scratch; i++) {
    const { between } = mark("scratch", i);
    let x1 = 0;
    let y1 = 0;
    // A few tries to land outside the art; a scratch that will not is put along the bottom margin.
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      x1 = between(3, 97);
      y1 = between(3, 137);
      placed = !inArt(x1, y1);
    }
    if (!placed) {
      x1 = between(3, 97);
      y1 = between(110, 137);
    }
    const angle = between(0, Math.PI);
    const length = between(6, 14) + wear * 12;
    const end = (a: number) => [Math.min(100, Math.max(0, x1 + Math.cos(a) * length)), Math.min(140, Math.max(0, y1 + Math.sin(a) * length))] as const;
    // The scratch runs away from the art, not into it.
    let [x2, y2] = end(angle);
    if (inArt(x2, y2)) [x2, y2] = end(angle + Math.PI);
    if (inArt(x2, y2)) {
      // Both ways cross the art: keep the scratch short enough to stop at its edge.
      x2 = x1;
      y2 = y1 + (y1 < 70 ? -1 : 1) * Math.min(length, 6);
      y2 = Math.min(140, Math.max(0, y2));
    }
    scratches.push({ x1, y1, x2, y2, opacity: between(0.25, 0.45) + wear * 0.15 });
  }

  // A crease runs across a corner, from one edge to the next.
  const creases: WearProfile["creases"] = [];
  for (let i = 0; i < counts.crease; i++) {
    const { rand, between } = mark("crease", i);
    const corner = Math.floor(rand() * 4);
    const a = between(12, 45);
    const b = between(12, 45);
    const [cx, cy] = corner === 0 ? [0, 0] : corner === 1 ? [100, 0] : corner === 2 ? [100, 140] : [0, 140];
    const sx = cx === 0 ? 1 : -1;
    const sy = cy === 0 ? 1 : -1;
    creases.push({ x1: cx + sx * a, y1: cy, x2: cx, y2: cy + sy * b });
  }

  /** A point off the art, after a few tries; failing that, in the bottom margin. */
  const offArt = (between: (lo: number, hi: number) => number): [number, number] => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = between(4, 96);
      const y = between(4, 136);
      if (!inArt(x, y)) return [x, y];
    }
    return [between(4, 96), between(108, 136)];
  };

  const dust: WearProfile["dust"] = [];
  for (let i = 0; i < counts.dust; i++) {
    const { rand, between } = mark("dust", i);
    dust.push({ x: between(1, 99), y: between(1, 139), r: between(0.3, 0.7), dark: rand() < 0.4 });
  }

  const smudges: WearProfile["smudges"] = [];
  for (let i = 0; i < counts.smudge; i++) {
    const { between } = mark("smudge", i);
    const [x, y] = offArt(between);
    smudges.push({ x, y, rx: between(5, 9) + wear * 4, ry: between(3, 6) + wear * 2, angle: between(0, 180), opacity: between(0.08, 0.14) + wear * 0.06 });
  }

  const printLines: WearProfile["printLines"] = [];
  for (let i = 0; i < counts.printLine; i++) {
    const { between } = mark("printLine", i);
    printLines.push({ y: between(6, 134), opacity: between(0.2, 0.35) });
  }

  const dents: WearProfile["dents"] = [];
  for (let i = 0; i < counts.dent; i++) {
    const { between } = mark("dent", i);
    const [x, y] = offArt(between);
    dents.push({ x, y, r: between(0.8, 1.4) + wear * 0.8 });
  }

  // A stain sits against an edge, where a card is picked up and put down.
  const stains: WearProfile["stains"] = [];
  for (let i = 0; i < counts.stain; i++) {
    const { rand, between } = mark("stain", i);
    const side = Math.floor(rand() * 4);
    const along = between(8, 92);
    const inset = between(2, 7);
    const [x, y] = side === 0 ? [along, inset] : side === 1 ? [100 - inset, along * 1.4] : side === 2 ? [along, 140 - inset] : [inset, along * 1.4];
    stains.push({ x, y, rx: between(4, 8) + wear * 4, ry: between(2.5, 5) + wear * 2, angle: between(0, 180), opacity: between(0.14, 0.22) + wear * 0.08 });
  }

  const peels = cornerOrder("peel-order")
    .slice(0, counts.peel)
    .map((corner, i) => ({ corner, size: mark("peel", i).between(0.5, 0.9) + wear * 0.4 }));

  // Some cards yellow with age and some do not; how far is the seed's choice, within what the grade allows.
  const toning = pristine ? 0 : Math.max(toningFloor, unit(id, "toning") * wear * 0.35);

  // A played card curls; a foil one curls sooner, because the foil layer
  // shrinks and swells differently from the card stock. How far is the
  // grade's; which way is the seed's.
  const axis: "x" | "y" = unit(id, "warp", "axis") < 0.5 ? "x" : "y";
  const sign = unit(id, "warp", "sign") < 0.5 ? -1 : 1;
  let curl = g < 5 ? ((5 - g) / 4) * 4 : 0;
  if (finish && g <= 8) curl = Math.max(curl, 1.5 + ((8 - g) / 7) * 2.5);
  const degrees = graded || pristine ? 0 : curl;

  return {
    grade: g,
    wear,
    gloss: 1 - wear * 0.8,
    centering,
    corners,
    edges,
    scratches,
    creases,
    dust,
    smudges,
    printLines,
    dents,
    stains,
    toning,
    peels,
    silvering: Boolean(finish) && edges.length > 0,
    warp: { axis, degrees: degrees ? sign * degrees : 0 },
    count:
      corners.length + edges.length + scratches.length + creases.length + dust.length + smudges.length + printLines.length + dents.length + stains.length + peels.length,
  };
}
