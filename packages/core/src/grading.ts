import { round2 } from "./pricing/match";

/**
 * The grade / wait / skip verdict, generalised.
 *
 * Written for trading cards and moved here so a sealed game or a raw comic
 * gets the same reasoning: how much a graded outcome would add over what the
 * copy is worth today, whether that gap is at its widest, and whether it
 * clears the fee. The card app re-exports these with its own defaults.
 *
 * It works on any summary that carries an ungraded price, real graded prices
 * keyed by grade, and estimated graded prices keyed the same way.
 */
export interface GradedSummary {
  ungraded: number | null;
  yourCopyValue: number | null;
  graded: Record<string, number>;
  estimatedGraded: Record<string, number>;
}

export interface GradingSettings {
  gradingFee: number;
  readyMinUpside: number;
  readyMinUpsidePercent: number;
}

export interface GradeKeys {
  /** Keys that name the best realistic outcome (gem mint), in order of preference. */
  maxKeys: string[];
  /** Keys that name a realistic low outcome (a mid grade), in order of preference. */
  minKeys: string[];
  /** Prefixes tried when pricing a specific expected grade, e.g. "PSA", "Grade", "CGC". */
  companies?: string[];
}

export const CARD_GRADE_KEYS: GradeKeys = {
  maxKeys: ["PSA 10", "BGS 10", "CGC 10", "SGC 10"],
  minKeys: ["PSA 8", "Grade 8", "CGC 8", "BGS 8", "PSA 7", "Grade 7"],
  companies: ["PSA", "Grade", "CGC", "BGS"],
};

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
  /** Value at the grade the photo suggests this copy would receive, when one was estimated. */
  likely: number | null;
  likelyLabel: string | null;
}

function pick(summary: GradedSummary, keys: string[]): { value: number; label: string; real: boolean } | null {
  for (const k of keys) if (summary.graded[k]) return { value: summary.graded[k], label: k, real: true };
  for (const k of keys) if (summary.estimatedGraded[k]) return { value: summary.estimatedGraded[k], label: k, real: false };
  return null;
}

/** Price at a specific expected grade, from real data first then the multiplier estimates. */
function atGrade(summary: GradedSummary, grade: string | null | undefined, companies: string[]): { value: number; label: string } | null {
  const g = (grade ?? "").trim().replace(/[^0-9.]/g, "");
  if (!g) return null;
  const keys = companies.map((c) => `${c} ${g}`);
  for (const key of keys) if (summary.graded[key]) return { value: summary.graded[key], label: key };
  for (const key of keys) if (summary.estimatedGraded[key]) return { value: summary.estimatedGraded[key], label: key };
  return null;
}

/** Outlook from one snapshot; null when the copy has no usable price. */
export function gradingOutlook(
  summary: GradedSummary,
  settings: GradingSettings,
  expectedGrade?: string | null,
  keys: GradeKeys = CARD_GRADE_KEYS,
): Outlook | null {
  const raw = summary.yourCopyValue ?? summary.ungraded;
  if (!raw) return null;
  const max = pick(summary, keys.maxKeys);
  if (!max) return null;
  const min = pick(summary, keys.minKeys) ?? { value: raw, label: "Ungraded", real: false };
  const fee = settings.gradingFee;
  const likely = atGrade(summary, expectedGrade, keys.companies ?? CARD_GRADE_KEYS.companies!);
  return {
    likely: likely?.value ?? null,
    likelyLabel: likely?.label ?? null,
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

export function outlookSeries(
  snapshots: Array<{ id: number; fetchedAt: string; summary: GradedSummary }>,
  settings: GradingSettings,
  expectedGrade?: string | null,
  keys: GradeKeys = CARD_GRADE_KEYS,
): OutlookPoint[] {
  return [...snapshots]
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id)
    .flatMap((s) => {
      const o = gradingOutlook(s.summary, settings, expectedGrade, keys);
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
 * Heuristic on when to send a raw copy in. "Prime" means the gap between the
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
export function isReadyToGrade(series: OutlookPoint[], verdict: Verdict, settings: GradingSettings): boolean {
  const last = series[series.length - 1];
  if (!last || verdict.kind !== "prime") return false;
  if (last.upside < settings.readyMinUpside) return false;
  return last.raw <= 0 || (last.upside / last.raw) * 100 >= settings.readyMinUpsidePercent;
}

/** Badge styling per verdict, shared so every app says "prime" in the same colour. */
export const VERDICT_STYLE: Record<VerdictKind, string> = {
  prime: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  wait: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  skip: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100",
  insufficient: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
};

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
