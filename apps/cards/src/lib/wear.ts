import type { Condition } from "./types";

/**
 * What a card's grade implies about its surface, decided once from the grade
 * and a seed so the same card always shows the same marks. Everything here
 * is geometry for `Card3D`; nothing touches the database.
 */

/** The condition the vision model read from the photo, when it left one. */
export interface Assessment {
  centering?: string | null;
  corners?: string | null;
  edges?: string | null;
  surface?: string | null;
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
  /** Every mark above, for tests and a data attribute. */
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

export function wearProfile({ seed, grade, assessment }: { seed: number; grade: number; assessment?: Assessment | null }): WearProfile {
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
  let centeringScale = pristine ? 0 : wear * 4;

  // What the photo showed decides where the wear concentrates, never whether
  // a gem-mint card has any: the grade already settled that.
  if (!pristine && assessment) {
    if (mentions(assessment.corners, /soft|round|worn|whit|ding|fray|bent/i)) cornerCount = Math.min(4, cornerCount + 1);
    if (mentions(assessment.edges, /whit|chip|wear|rough|nick|fray/i)) edgeCount = Math.min(8, edgeCount + 1);
    if (mentions(assessment.surface, /scratch|scuff|print line|dent|crease|wear|scuf/i)) scratchCount = Math.min(14, scratchCount + 2);
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

  return {
    grade: g,
    wear,
    gloss: 1 - wear * 0.8,
    centering,
    corners,
    edges,
    scratches,
    creases,
    count: corners.length + edges.length + scratches.length + creases.length,
  };
}
