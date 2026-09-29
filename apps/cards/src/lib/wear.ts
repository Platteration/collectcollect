import type { Condition } from "./types";

/**
 * What a card's grade implies about its surface — corner and edge wear,
 * scratches, creases, dust, fingerprints, print lines, dents, stains and
 * yellowing — decided once from the grade and a seed so the same card
 * always shows the same marks. Everything here is geometry for `Card3D`;
 * nothing touches the database.
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

const mentions = (text: string | null | undefined, words: RegExp) => Boolean(text && words.test(text));

/** The art sits roughly in this box of the 100 × 140 card; scratches stay out of it. */
const ART = { x1: 28, y1: 34, x2: 72, y2: 104 };
const inArt = (x: number, y: number) => x > ART.x1 && x < ART.x2 && y > ART.y1 && y < ART.y2;

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
  const rand = mulberry32(Math.round(seed) || 1);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

  // How many of each mark is decided by the grade alone; the seed only says
  // where they fall. So a lower grade never has fewer marks than a higher one.
  const pristine = g >= 9.5;
  let cornerCount = pristine ? 0 : Math.min(4, Math.ceil(wear * 4.4));
  let edgeCount = pristine ? 0 : Math.round(wear * 6);
  let scratchCount = pristine ? 0 : Math.round(wear * wear * 10);
  const creaseCount = g <= 2 ? 2 : g <= 3 ? 1 : 0;
  let dustCount = pristine ? 0 : Math.round(2 + wear * 12);
  let smudgeCount = pristine ? 0 : Math.round(wear * 4);
  let printLineCount = g <= 5 ? 2 : g <= 8.5 ? 1 : 0;
  const dentCount = g <= 6 ? Math.round(((6 - g) / 5) * 3) + 1 : 0;
  let stainCount = g <= 2 ? 2 : g <= 4 ? 1 : 0;
  let toningFloor = 0;
  let centeringScale = pristine ? 0 : wear * 4;

  // What the photo showed decides where the wear concentrates, never whether
  // a gem-mint card has any: the grade already settled that.
  if (!pristine && assessment) {
    if (mentions(assessment.corners, /soft|round|worn|whit|ding|fray|bent/i)) cornerCount = Math.min(4, cornerCount + 1);
    if (mentions(assessment.edges, /whit|chip|wear|rough|nick|fray/i)) edgeCount = Math.min(8, edgeCount + 1);
    if (mentions(assessment.surface, /scratch|scuff|crease|wear|scuf/i)) scratchCount = Math.min(14, scratchCount + 2);
    if (mentions(assessment.surface, /smudge|fingerprint|print\b|grease|oil/i)) smudgeCount = Math.min(6, smudgeCount + 1);
    if (mentions(assessment.surface, /dust|speck|debris|particle/i)) dustCount = Math.min(20, dustCount + 3);
    if (mentions(assessment.surface, /print line|printing line|roller/i)) printLineCount = Math.min(3, printLineCount + 1);
    if (mentions(assessment.surface, /stain|discolo|yellow|toning|toned|foxing|tan/i)) {
      stainCount = Math.min(3, stainCount + 1);
      toningFloor = 0.12;
    }
    if (mentions(assessment.centering, /off|oc\b|\d{2}\s*\/\s*\d{2}|left|right|high|low/i) && !mentions(assessment.centering, /well|good|centered|50\s*\/\s*50/i)) {
      centeringScale = Math.max(1, centeringScale * 1.5);
    }
  }

  const centering = { dx: centeringScale ? between(-1, 1) * centeringScale : 0, dy: centeringScale ? between(-1, 1) * centeringScale : 0 };

  // Corners wear in a random order, one at a time.
  const order = ([0, 1, 2, 3] as const).map((c) => ({ c, k: rand() })).sort((a, b) => a.k - b.k);
  const corners = order.slice(0, cornerCount).map(({ c }) => ({ corner: c, size: between(0.3, 0.6) + wear * 0.4 }));

  const edges: WearProfile["edges"] = [];
  for (let i = 0; i < edgeCount; i++) {
    const side = Math.floor(rand() * 4) as 0 | 1 | 2 | 3;
    const length = between(0.08, 0.2) + wear * 0.15;
    edges.push({ side, start: between(0, 1 - length), length, strength: between(0.3, 0.6) + wear * 0.3 });
  }

  const scratches: WearProfile["scratches"] = [];
  for (let i = 0; i < scratchCount; i++) {
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
  for (let i = 0; i < creaseCount; i++) {
    const corner = Math.floor(rand() * 4);
    const a = between(12, 45);
    const b = between(12, 45);
    const [cx, cy] = corner === 0 ? [0, 0] : corner === 1 ? [100, 0] : corner === 2 ? [100, 140] : [0, 140];
    const sx = cx === 0 ? 1 : -1;
    const sy = cy === 0 ? 1 : -1;
    creases.push({ x1: cx + sx * a, y1: cy, x2: cx, y2: cy + sy * b });
  }

  /** A point off the art, after a few tries; failing that, in the bottom margin. */
  const offArt = (): [number, number] => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = between(4, 96);
      const y = between(4, 136);
      if (!inArt(x, y)) return [x, y];
    }
    return [between(4, 96), between(108, 136)];
  };

  const dust: WearProfile["dust"] = [];
  for (let i = 0; i < dustCount; i++) {
    dust.push({ x: between(1, 99), y: between(1, 139), r: between(0.3, 0.7), dark: rand() < 0.4 });
  }

  const smudges: WearProfile["smudges"] = [];
  for (let i = 0; i < smudgeCount; i++) {
    const [x, y] = offArt();
    smudges.push({ x, y, rx: between(5, 9) + wear * 4, ry: between(3, 6) + wear * 2, angle: between(0, 180), opacity: between(0.08, 0.14) + wear * 0.06 });
  }

  const printLines: WearProfile["printLines"] = [];
  for (let i = 0; i < printLineCount; i++) {
    printLines.push({ y: between(6, 134), opacity: between(0.2, 0.35) });
  }

  const dents: WearProfile["dents"] = [];
  for (let i = 0; i < dentCount; i++) {
    const [x, y] = offArt();
    dents.push({ x, y, r: between(0.8, 1.4) + wear * 0.8 });
  }

  // A stain sits against an edge, where a card is picked up and put down.
  const stains: WearProfile["stains"] = [];
  for (let i = 0; i < stainCount; i++) {
    const side = Math.floor(rand() * 4);
    const along = between(8, 92);
    const inset = between(2, 7);
    const [x, y] = side === 0 ? [along, inset] : side === 1 ? [100 - inset, along * 1.4] : side === 2 ? [along, 140 - inset] : [inset, along * 1.4];
    stains.push({ x, y, rx: between(4, 8) + wear * 4, ry: between(2.5, 5) + wear * 2, angle: between(0, 180), opacity: between(0.14, 0.22) + wear * 0.08 });
  }

  // Some cards yellow with age and some do not; how far is the seed's choice, within what the grade allows.
  const toning = pristine ? 0 : Math.max(toningFloor, rand() * wear * 0.35);

  // Everything below draws after the marks above, so adding it changed no
  // card's existing marks.

  const peelCount = !finish ? 0 : g <= 2 ? 2 : g <= 4 ? 1 : 0;
  const peelOrder = ([0, 1, 2, 3] as const).map((c) => ({ c, k: rand() })).sort((a, b) => a.k - b.k);
  const peels = peelOrder.slice(0, peelCount).map(({ c }) => ({ corner: c, size: between(0.5, 0.9) + wear * 0.4 }));

  // A played card curls; a foil one curls sooner, because the foil layer
  // shrinks and swells differently from the card stock. How far is the
  // grade's; which way is the seed's.
  const axis: "x" | "y" = rand() < 0.5 ? "x" : "y";
  const sign = rand() < 0.5 ? -1 : 1;
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
