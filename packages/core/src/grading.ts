import { round2 } from "./pricing/match";
import { extent } from "./series";

/**
 * The grade / wait / skip verdict, generalised.
 *
 * Written for trading cards so a sealed game or a raw comic gets the same
 * reasoning: how much a graded outcome would add over what the copy is worth
 * today, whether that gap is at its widest, and whether it clears the fee.
 *
 * The card app keeps its own version of the verdict (gradingVerdict and
 * isReadyToGrade in apps/cards/src/lib/analytics.ts), which also reads a
 * measured centering and records where each price came from. What is shared
 * is the rule that decides the verdict, and a change to one is made to the
 * other: a verdict reads one price per day, needs three days of them, and
 * says "recorded" because it compares what was recorded here and predicts
 * nothing.
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
  maxKeys: ["PSA 10", "BGS 10", "CGC 10", "SGC 10", "TAG 10"],
  minKeys: ["PSA 8", "Grade 8", "CGC 8", "BGS 8", "PSA 7", "Grade 7"],
  companies: ["PSA", "Grade", "CGC", "BGS", "SGC", "TAG"],
};

/** The companies a key set prices an expected grade by; the card companies when it names none. */
function companiesOf(keys: GradeKeys): string[] {
  return keys.companies ?? CARD_GRADE_KEYS.companies ?? [];
}

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
  /**
   * Whether the best case (max) came from a real graded sale (true) or from
   * the multiplier estimates. The card app's own flag also asks it of the low
   * case; here the low case can be the raw price itself, as it is for a
   * sealed game that has no mid grade, so only the best case is asked.
   */
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
  const likely = atGrade(summary, expectedGrade, companiesOf(keys));
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
 * gem-mint price and the raw price is at or near the widest it has been among
 * the days recorded and comfortably clears the grading fee; "wait" means the
 * gap is narrower than it was; "skip" means even a gem-mint result would not
 * pay for the fee.
 *
 * The timing is read from one point per day, the day's last, and judged only
 * once there are three days: pressing Refresh three times in an afternoon is
 * one day of history, not three. It compares recorded prices and does not
 * predict the grade a copy would get or what it would sell for.
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
  const days = new Map<string, OutlookPoint>();
  for (const point of series) days.set(point.t.slice(0, 10), point);
  const daily = [...days.values()];
  if (daily.length < 3) {
    return {
      kind: "insufficient",
      headline: `Up to ${fmt(last.upside)} upside`,
      detail: "This comparison needs prices from at least three different days. Repeated refreshes today do not add another day of history.",
      upsideVsPeak: null,
    };
  }
  const [, peak] = extent(daily.map((p) => p.upside));
  const ratio = peak > 0 ? last.upside / peak : 0;
  const trend = last.upside - (daily[Math.max(0, daily.length - 4)] ?? last).upside;
  if (ratio >= 0.9) {
    return {
      kind: "prime",
      headline: "Near the best recorded premium",
      detail: `The ${last.maxLabel} premium over raw is ${fmt(last.upside)} after fees, ${ratio >= 0.999 ? "the widest" : "close to the widest"} recorded here.${trend > 0 ? " Still widening." : ""} This comparison does not predict the grade or a sale price.`,
      upsideVsPeak: ratio,
    };
  }
  return {
    kind: "wait",
    headline: "Gap has narrowed",
    detail: `Upside is ${fmt(last.upside)} now versus ${fmt(peak)} at its widest recorded here. ${trend > 0 ? "The recorded gap has increased recently." : "The recorded gap is below its earlier peak."}`,
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
