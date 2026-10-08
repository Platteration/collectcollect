import { GRADING_AGENCIES, type Centering, type CenteringSide, type Game, type GradingAgency, type Identification, type Ratio } from "../types";
import { agencyOf } from "./agencies";

/**
 * Centering as graders measure it: how the borders split, left against right
 * and top against bottom, on the front and on the back. A 55/45 means the
 * left (or top) border takes 55% of the two. Every company publishes how far
 * off a card may be at each grade, which is what caps the grading outlook.
 */

/** The one message a refused ratio carries. */
export function badRatio(input: unknown): Error {
  return new Error(`Centering has to be two numbers that add up to 100, like 55/45, not ${JSON.stringify(String(input))}`);
}

// "55/45", "55 / 45", "55-45", "55:45", "55 45", "55%/45%", "54L/46R", "49T/51B".
const PAIR = /^\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*[LTRB]?\s*(?:[/:\-–]|\s+)\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*[LTRB]?\s*$/i;
const SINGLE = /^\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*$/;

function toRatio(a: number, b: number, input: unknown): Ratio {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a > 100 || b > 100 || Math.abs(a + b - 100) > 1) throw badRatio(input);
  const first = Math.round(a);
  return [first, 100 - first];
}

/** Whether a string is one ratio rather than a side's two or prose. */
export function looksLikeOneRatio(text: string): boolean {
  return PAIR.test(text) || SINGLE.test(text);
}

/**
 * One ratio from whatever shape it arrives in: "55/45" and its spellings, a
 * pair, or a single number that stands for the first border. Blank is null;
 * anything that is not two numbers adding up to 100 is refused with a reason.
 */
export function parseRatio(input: unknown): Ratio | null {
  if (input === null || input === undefined) return null;
  if (Array.isArray(input)) {
    if (input.length === 0) return null;
    if (input.length !== 2) throw badRatio(input);
    return toRatio(Number(input[0]), Number(input[1]), input);
  }
  if (typeof input === "number") return toRatio(input, 100 - input, input);
  const text = String(input).trim();
  if (!text) return null;
  const pair = PAIR.exec(text);
  if (pair) return toRatio(Number(pair[1]), Number(pair[2]), text);
  const single = SINGLE.exec(text);
  if (single) {
    const a = Number(single[1]);
    return toRatio(a, 100 - a, text);
  }
  throw badRatio(text);
}

/** "54L/46R 49T/51B", "55/45 52/48" or just "55/45": one side's ratios, as a report prints them. */
export function parseSide(text: string): CenteringSide {
  const trimmed = text.trim();
  if (!trimmed) return { lr: null, tb: null };
  if (looksLikeOneRatio(trimmed)) return { lr: parseRatio(trimmed), tb: null };
  const tokens = trimmed.split(/\s+(?=\d)/).filter(Boolean);
  if (tokens.length > 2) throw badRatio(text);
  const side: CenteringSide = { lr: null, tb: null };
  const untagged: Ratio[] = [];
  for (const token of tokens) {
    const ratio = parseRatio(token);
    if (!ratio) continue;
    const letters = token.replace(/[^A-Za-z]/g, "").toUpperCase();
    if (/[TB]/.test(letters) && !/[LR]/.test(letters)) side.tb = ratio;
    else if (/[LR]/.test(letters)) side.lr = ratio;
    else untagged.push(ratio);
  }
  for (const r of untagged) {
    if (!side.lr) side.lr = r;
    else if (!side.tb) side.tb = r;
  }
  return side;
}

/** "55/45" for a ratio, "" for none; what the form shows and the file prints. */
export function ratioText(r: Ratio | null | undefined): string {
  return r ? `${r[0]}/${r[1]}` : "";
}

export const EMPTY_SIDE: CenteringSide = { lr: null, tb: null };

export function isEmptyCentering(c: Centering | null | undefined): boolean {
  return !c || (!c.front.lr && !c.front.tb && !c.back.lr && !c.back.tb);
}

/**
 * The ratios in what the vision model wrote about centering: "60/40
 * left-right, 55/45 top-bottom", "about 55/45", "back 70/30". Each pair goes
 * to the axis and side its clause names; an unnamed pair takes left-right
 * first, then top-bottom. Prose with no pair in it ("well centered") is null.
 */
export function parseCentering(text: string | null | undefined): Centering | null {
  if (!text) return null;
  const out: Centering = { front: { lr: null, tb: null }, back: { lr: null, tb: null } };
  const untagged: Array<{ side: "front" | "back"; ratio: Ratio }> = [];
  let any = false;
  for (const clause of text.split(/[,;.]|\band\b/i)) {
    const side: "front" | "back" = /\b(back|reverse)\b/i.test(clause) ? "back" : "front";
    for (const m of clause.matchAll(/(\d{1,3})\s*([LTRB])?\s*\/\s*(\d{1,3})\s*([LTRB])?/gi)) {
      const a = Number(m[1]);
      const b = Number(m[3]);
      if (a > 100 || b > 100 || Math.abs(a + b - 100) > 1) continue;
      const ratio: Ratio = [a, 100 - a];
      const letters = `${m[2] ?? ""}${m[4] ?? ""}`.toUpperCase();
      const axis = /[TB]/.test(letters) && !/[LR]/.test(letters) ? "tb"
        : /[LR]/.test(letters) ? "lr"
        : /left|right|horizontal|l\s*\/\s*r/i.test(clause) ? "lr"
        : /top|bottom|vertical|t\s*\/\s*b/i.test(clause) ? "tb"
        : null;
      any = true;
      if (axis) {
        if (!out[side][axis]) out[side][axis] = ratio;
      } else untagged.push({ side, ratio });
    }
  }
  for (const u of untagged) {
    const s = out[u.side];
    if (!s.lr) s.lr = u.ratio;
    else if (!s.tb) s.tb = u.ratio;
  }
  return any ? out : null;
}

/** The centering an identification carries: its numeric ratios first, then whatever its prose says. */
export function centeringFromIdentification(id: Identification | null | undefined): Centering | null {
  const assessment = id?.condition_assessment;
  if (!assessment) return null;
  const ratios = assessment.centering_ratios;
  if (ratios) {
    const read = (v: string | null | undefined): Ratio | null => {
      try {
        return parseRatio(v);
      } catch {
        return null; // the model wrote something that is not a ratio; the prose may still say
      }
    };
    const c: Centering = { front: { lr: read(ratios.front_lr), tb: read(ratios.front_tb) }, back: { lr: read(ratios.back_lr), tb: read(ratios.back_tb) } };
    if (!isEmptyCentering(c)) return c;
  }
  return parseCentering(assessment.centering);
}

/** The larger border of an axis: what every limit is measured against. */
const larger = (r: Ratio): number => Math.max(r[0], r[1]);

/** The worst axis on one side, as the larger border's share; null when nothing is measured. */
export function worstOf(side: CenteringSide | null | undefined): number | null {
  if (!side) return null;
  const values = [side.lr, side.tb].filter((r): r is Ratio => r !== null).map(larger);
  return values.length ? Math.max(...values) : null;
}

const AXIS_NAME = { lr: "left-right", tb: "top-bottom" } as const;

/** The single axis furthest off, front before back on a tie. */
export function worstAxis(c: Centering): { side: "front" | "back"; axis: "lr" | "tb"; ratio: Ratio } | null {
  let worst: { side: "front" | "back"; axis: "lr" | "tb"; ratio: Ratio } | null = null;
  for (const side of ["front", "back"] as const) {
    for (const axis of ["lr", "tb"] as const) {
      const ratio = c[side][axis];
      if (ratio && (!worst || larger(ratio) > larger(worst.ratio))) worst = { side, axis, ratio };
    }
  }
  return worst;
}

/** "front 60/40 left-right, 55/45 top-bottom; back 70/30 left-right" */
export function describeCentering(c: Centering): string {
  const side = (name: "front" | "back"): string | null => {
    const parts = (["lr", "tb"] as const).filter((axis) => c[name][axis]).map((axis) => `${ratioText(c[name][axis])} ${AXIS_NAME[axis]}`);
    return parts.length ? `${name} ${parts.join(", ")}` : null;
  };
  return [side("front"), side("back")].filter(Boolean).join("; ");
}

/**
 * The published limits. Each row is the loosest ratio a grade allows, as the
 * larger border's share; the back is null where a company does not say, and
 * TAG's back limit depends on whether the card is a sports card. The rows are
 * best grade first, and the floor is what a card past every row can still get.
 *
 * These come from guides quoting each company's standard, not from the
 * company's own page, which could not be reached when they were written; the
 * UI says they are approximate and names where to check.
 */
export interface ToleranceRow {
  grade: number;
  /** A named tier at this grade, e.g. "Pristine 10"; the plain number otherwise. */
  label?: string;
  front: number;
  back: number | null | { tcg: number; sports: number };
}
export interface AgencyLimits {
  rows: ToleranceRow[];
  floor: number;
  /** The company's own standards page, to check against. */
  official: string;
  note: string;
}

const PSA_ROWS: ToleranceRow[] = [
  { grade: 10, front: 55, back: 75 },
  { grade: 9, front: 60, back: 90 },
  { grade: 8, front: 65, back: 90 },
  { grade: 7, front: 70, back: 90 },
  { grade: 6, front: 80, back: 90 },
  { grade: 5, front: 85, back: 90 },
  { grade: 4, front: 85, back: 90 },
  { grade: 3, front: 90, back: 90 },
];
const APPROXIMATE = "Approximate: taken from guides quoting the standard, not from the company's own page. Check it before sending a card in.";

export const CENTERING_LIMITS: Partial<Record<GradingAgency, AgencyLimits>> = {
  PSA: { rows: PSA_ROWS, floor: 2, official: "https://www.psacard.com/gradingstandards", note: APPROXIMATE },
  CGC: {
    rows: [
      { grade: 10, label: "Pristine 10", front: 52, back: 55 },
      { grade: 10, label: "Gem Mint 10", front: 55, back: 75 },
      { grade: 9, front: 60, back: 90 },
      { grade: 8, front: 65, back: null },
    ],
    floor: 7,
    official: "https://www.cgccards.com/card-grading/grading-scale/",
    note: `${APPROXIMATE} CGC's back limit below a 9 was not found.`,
  },
  BGS: {
    rows: [
      { grade: 10, label: "Pristine 10", front: 55, back: 55 },
      { grade: 9.5, front: 55, back: 60 },
      { grade: 9, front: 60, back: 65 },
      { grade: 8.5, front: 70, back: null },
    ],
    floor: 8,
    official: "https://www.beckett.com/grading/grading-scale",
    note: `${APPROXIMATE} Beckett's back limit below a 9 was not found.`,
  },
  SGC: { rows: PSA_ROWS, floor: 2, official: "https://www.gosgc.com/grading-scale", note: `${APPROXIMATE} SGC's own limits were not found, so PSA's are used.` },
  TAG: {
    rows: [
      { grade: 10, label: "Pristine 10", front: 51, back: { tcg: 52, sports: 54 } },
      { grade: 10, label: "Gem Mint 10", front: 55, back: { tcg: 65, sports: 70 } },
      { grade: 9, front: 60, back: { tcg: 75, sports: 90 } },
      { grade: 8.5, front: 62, back: { tcg: 85, sports: 95 } },
      { grade: 8, front: 65, back: { tcg: 95, sports: 95 } },
      { grade: 7, front: 70, back: null },
      { grade: 6, front: 75, back: null },
      { grade: 4, front: 85, back: null },
      { grade: 3, front: 90, back: null },
      { grade: 2, front: 95, back: null },
    ],
    floor: 1,
    official: "https://taggrading.com/pages/rubric",
    note: `${APPROXIMATE} TAG allows the back of a sports card to be further off than a trading card game card's.`,
  },
  ACE: {
    rows: [{ grade: 10, front: 60, back: null }],
    floor: 9,
    official: "https://acegrading.com/grading-scale",
    note: `${APPROXIMATE} Only ACE's limit for a 10 was found.`,
  },
};

export interface CenteringCap {
  company: GradingAgency;
  grade: number;
  /** "PSA 9", "CGC Pristine 10". */
  label: string;
  /** The axis that decided it: "front 60/40 left-right". */
  reason: string;
}

/**
 * The best grade a company's centering limits leave open to this card. The
 * front decides; the back is checked when it is known and the company says.
 * No agency, no limits for it, or nothing measured on the front: no cap.
 */
export function highestGradeAllowed(company: string | null | undefined, centering: Centering | null | undefined, game?: Game | null): CenteringCap | null {
  const agency = agencyOf(company);
  if (!agency || !centering) return null;
  const limits = CENTERING_LIMITS[agency.id];
  const front = worstOf(centering.front);
  if (!limits || front === null) return null;
  const back = worstOf(centering.back);
  const worst = worstAxis(centering);
  const reason = worst ? `${worst.side} ${ratioText(worst.ratio)} ${AXIS_NAME[worst.axis]}` : "";
  for (const row of limits.rows) {
    const limit = row.back !== null && typeof row.back === "object" ? (game === "sports" ? row.back.sports : row.back.tcg) : row.back;
    if (front <= row.front && (back === null || limit === null || back <= limit)) {
      return { company: agency.id, grade: row.grade, label: `${agency.id} ${row.label ?? row.grade}`, reason };
    }
  }
  return { company: agency.id, grade: limits.floor, label: `${agency.id} ${limits.floor}`, reason };
}

/** One cap per company that publishes limits, in the order the companies are listed. */
export function capsFor(centering: Centering | null | undefined, game?: Game | null): CenteringCap[] {
  return GRADING_AGENCIES.map((id) => highestGradeAllowed(id, centering, game)).filter((cap): cap is CenteringCap => cap !== null);
}

/**
 * How far the 3D view shifts the print for a measured centering: a wider
 * left border pushes the art right, a wider top border pushes it down, three
 * tenths of a percent of the card per point off centre, up to four. Null when
 * nothing on the front is measured, so the renderer falls back to its own.
 */
export function centeringOffset(c: Centering | null | undefined): { dx: number; dy: number } | null {
  if (!c || (!c.front.lr && !c.front.tb)) return null;
  const shift = (r: Ratio | null) => (r ? Math.max(-4, Math.min(4, ((r[0] - 50) * 3) / 10)) : 0);
  return { dx: shift(c.front.lr), dy: shift(c.front.tb) };
}
