import type { CardRecord, PriceSnapshot, PriceSummary, Settings } from "./types";
import { round2 } from "./pricing/match";

// ---------------------------------------------------------------------------
// Portfolio value over time
// ---------------------------------------------------------------------------

export interface PortfolioPoint {
  /** ISO timestamp */
  t: string;
  /** Sum of yourCopyValue × quantity using the latest snapshot per card at this time. */
  value: number;
  /** Sum of ungraded × quantity (what the collection would be worth raw NM). */
  ungraded: number;
  /** Cards that had a price at this point. */
  priced: number;
}

/**
 * Build a step series of total collection value. Each snapshot changes one
 * card's contribution; totals are recomputed at every snapshot time using the
 * most recent snapshot of every card. Quantities are taken from the cards as
 * they are now (there is no quantity history).
 */
export function portfolioSeries(cards: CardRecord[], snapshots: PriceSnapshot[]): PortfolioPoint[] {
  const qty = new Map(cards.map((c) => [c.id, c.quantity]));
  const current = new Map<number, { value: number; ungraded: number }>();
  const points: PortfolioPoint[] = [];
  const sorted = [...snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id);
  for (const s of sorted) {
    if (!qty.has(s.cardId)) continue; // card has been deleted
    const q = qty.get(s.cardId)!;
    current.set(s.cardId, {
      value: (s.summary.yourCopyValue ?? 0) * q,
      ungraded: (s.summary.ungraded ?? 0) * q,
    });
    let value = 0;
    let ungraded = 0;
    let priced = 0;
    for (const v of current.values()) {
      value += v.value;
      ungraded += v.ungraded;
      if (v.value > 0) priced++;
    }
    const point = { t: s.fetchedAt, value: round2(value), ungraded: round2(ungraded), priced };
    // Snapshots taken in the same second (e.g. "refresh all") collapse into one point.
    if (points.length && points[points.length - 1].t === point.t) points[points.length - 1] = point;
    else points.push(point);
  }
  return points;
}

export type Range = "1W" | "1M" | "3M" | "1Y" | "ALL";
export const RANGES: Range[] = ["1W", "1M", "3M", "1Y", "ALL"];

const RANGE_MS: Record<Exclude<Range, "ALL">, number> = {
  "1W": 7 * 864e5,
  "1M": 30 * 864e5,
  "3M": 91 * 864e5,
  "1Y": 365 * 864e5,
};

/** Slice a series to a range, keeping the last point before the window so the line has a start value. */
export function sliceRange<T extends { t: string }>(points: T[], range: Range, now = Date.now()): T[] {
  if (range === "ALL" || points.length === 0) return points;
  const from = now - RANGE_MS[range];
  const idx = points.findIndex((p) => new Date(p.t).getTime() >= from);
  if (idx === -1) return points.slice(-1);
  return points.slice(Math.max(0, idx - 1));
}

export interface Change {
  amount: number;
  percent: number | null;
  from: string | null;
}

export function change(points: Array<{ t: string; value: number }>): Change {
  if (points.length < 2) return { amount: 0, percent: null, from: null };
  const first = points[0];
  const last = points[points.length - 1];
  const amount = round2(last.value - first.value);
  return { amount, percent: first.value > 0 ? round2((amount / first.value) * 100) : null, from: first.t };
}

// ---------------------------------------------------------------------------
// Grading outlook for ungraded cards
// ---------------------------------------------------------------------------

export interface Outlook {
  /** What the owner's raw copy is worth today (condition-adjusted). */
  raw: number;
  /** Realistic low outcome after grading (a mid grade). */
  min: number;
  minLabel: string;
  /** Best realistic outcome after grading (gem mint). */
  max: number;
  maxLabel: string;
  fee: number;
  /** max − raw − fee: what grading could add at best. */
  upside: number;
  /** min − raw − fee: what grading adds if it comes back a mid grade (negative = you lose money). */
  downside: number;
  /** Whether min/max came from real graded sales (true) or from the multiplier estimates. */
  fromRealData: boolean;
}

const MAX_KEYS = ["PSA 10", "BGS 10", "CGC 10", "SGC 10"];
const MIN_KEYS = ["PSA 8", "Grade 8", "CGC 8", "BGS 8", "PSA 7", "Grade 7"];

function pick(summary: PriceSummary, keys: string[]): { value: number; label: string; real: boolean } | null {
  for (const k of keys) if (summary.graded[k]) return { value: summary.graded[k], label: k, real: true };
  for (const k of keys) if (summary.estimatedGraded[k]) return { value: summary.estimatedGraded[k], label: k, real: false };
  return null;
}

/** Outlook from one snapshot; null when the card has no usable ungraded price. */
export function gradingOutlook(summary: PriceSummary, settings: Settings): Outlook | null {
  const raw = summary.yourCopyValue ?? summary.ungraded;
  if (!raw) return null;
  const max = pick(summary, MAX_KEYS);
  if (!max) return null;
  const min = pick(summary, MIN_KEYS) ?? { value: raw, label: "Ungraded", real: false };
  const fee = settings.gradingFee;
  return {
    raw,
    min: min.value,
    minLabel: min.label,
    max: max.value,
    maxLabel: max.label,
    fee,
    upside: round2(max.value - raw - fee),
    downside: round2(min.value - raw - fee),
    fromRealData: max.real,
  };
}

export interface OutlookPoint extends Outlook {
  t: string;
}

export function outlookSeries(snapshots: PriceSnapshot[], settings: Settings): OutlookPoint[] {
  return [...snapshots]
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id)
    .flatMap((s) => {
      const o = gradingOutlook(s.summary, settings);
      return o ? [{ t: s.fetchedAt, ...o }] : [];
    });
}

export type VerdictKind = "prime" | "wait" | "skip" | "insufficient";

export interface Verdict {
  kind: VerdictKind;
  headline: string;
  detail: string;
  /** Current upside as a fraction of the best upside seen in the series (0–1). */
  upsideVsPeak: number | null;
}

/**
 * Heuristic on when to send a raw card in. "Prime" means the gap between the
 * gem-mint price and the raw price is at or near the widest it has been and
 * comfortably clears the grading fee; "wait" means the gap is narrower than it
 * was; "skip" means even a gem-mint result would not pay for the fee.
 */
export function gradingVerdict(series: OutlookPoint[]): Verdict {
  const last = series[series.length - 1];
  if (!last) return { kind: "insufficient", headline: "No price data", detail: "Refresh prices to see a grading outlook.", upsideVsPeak: null };
  if (last.upside <= 0) {
    return {
      kind: "skip",
      headline: "Not worth grading right now",
      detail: `Even a ${last.maxLabel} would return ${fmt(last.max)} against ${fmt(last.raw)} raw plus a ${fmt(last.fee)} fee.`,
      upsideVsPeak: null,
    };
  }
  if (series.length < 3) {
    return {
      kind: "insufficient",
      headline: `Up to ${fmt(last.upside)} upside`,
      detail: "Not enough history yet to tell whether the gap is widening. Prices refresh daily; check back in a week.",
      upsideVsPeak: null,
    };
  }
  const peak = Math.max(...series.map((p) => p.upside));
  const ratio = peak > 0 ? last.upside / peak : 0;
  const trend = last.upside - series[Math.max(0, series.length - 4)].upside;
  if (ratio >= 0.9) {
    return {
      kind: "prime",
      headline: "Good time to grade",
      detail: `The ${last.maxLabel} premium over raw is ${fmt(last.upside)} after fees, ${ratio >= 0.999 ? "the widest" : "close to the widest"} it has been.${trend > 0 ? " Still widening." : ""}`,
      upsideVsPeak: ratio,
    };
  }
  return {
    kind: "wait",
    headline: "Gap has narrowed",
    detail: `Upside is ${fmt(last.upside)} now versus ${fmt(peak)} at its widest. ${trend > 0 ? "It is recovering." : "Consider waiting for the graded premium to come back."}`,
    upsideVsPeak: ratio,
  };
}

/** Whether the latest outlook clears the owner's "ready to grade" thresholds and timing looks right. */
export function isReadyToGrade(series: OutlookPoint[], verdict: Verdict, settings: Settings): boolean {
  const last = series[series.length - 1];
  if (!last || verdict.kind !== "prime") return false;
  if (last.upside < settings.readyMinUpside) return false;
  return last.raw <= 0 || (last.upside / last.raw) * 100 >= settings.readyMinUpsidePercent;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

// ---------------------------------------------------------------------------
// Cost basis and return
// ---------------------------------------------------------------------------

export interface Returns {
  /** Sum of purchase price × quantity over cards with a recorded purchase price. */
  invested: number;
  /** Current value of those same cards. */
  valueOfInvested: number;
  amount: number;
  percent: number | null;
  /** How many cards have a purchase price recorded. */
  cardsWithCost: number;
}

/** Total return over the cards whose cost is known; cards without a purchase price are left out of both sides. */
export function totalReturn(cards: CardRecord[], valueOf: (card: CardRecord) => number | null): Returns {
  let invested = 0;
  let valueOfInvested = 0;
  let cardsWithCost = 0;
  for (const c of cards) {
    if (c.purchasePrice === null || c.purchasePrice < 0) continue;
    cardsWithCost++;
    invested += c.purchasePrice * c.quantity;
    valueOfInvested += (valueOf(c) ?? 0) * c.quantity;
  }
  const amount = round2(valueOfInvested - invested);
  return {
    invested: round2(invested),
    valueOfInvested: round2(valueOfInvested),
    amount,
    percent: invested > 0 ? round2((amount / invested) * 100) : null,
    cardsWithCost,
  };
}

export interface Allocation {
  game: CardRecord["game"];
  value: number;
  cards: number;
  share: number;
}

/** Value split by game, largest first. */
export function allocationByGame(cards: CardRecord[], valueOf: (card: CardRecord) => number | null): Allocation[] {
  const byGame = new Map<CardRecord["game"], { value: number; cards: number }>();
  let total = 0;
  for (const c of cards) {
    const v = (valueOf(c) ?? 0) * c.quantity;
    total += v;
    const cur = byGame.get(c.game) ?? { value: 0, cards: 0 };
    cur.value += v;
    cur.cards++;
    byGame.set(c.game, cur);
  }
  return [...byGame.entries()]
    .map(([game, { value, cards }]) => ({ game, value: round2(value), cards, share: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}
