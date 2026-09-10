import { gradeLookupKeys, summarizeGraded, type GradedExtras } from "@collectcollect/core/domain/pricing/index";
import { gradingVerdict, isReadyToGrade, outlookSeries, type GradeKeys, type GradingSettings, type OutlookPoint } from "@collectcollect/core/grading";
import { round2 } from "@collectcollect/core/pricing/match";
import type { ItemRecord, NewAlert, PriceError, PriceQuote, PriceSnapshot, PriceSummary, Settings } from "@collectcollect/core/domain/spec";
import { money } from "@collectcollect/core/format";
import { COMPANIES, DEFAULT_SETTINGS, gradeNumber, type Comic, type ComicSettings } from "../types";

/**
 * What a copy is worth. The graded summariser from the shared package does
 * the work: a slabbed copy reads the price at its grade (a CGC 9.8 reads
 * "Grade 9.8"), or an estimate from the raw price and the multiplier for
 * that grade; a raw copy reads the raw price scaled down for the grade the
 * owner thinks it would get. A witnessed signature is a premium on top.
 */

export type ComicExtras = GradedExtras;
export type ComicSummary = PriceSummary<ComicExtras>;

export const COMIC_GRADE_KEYS: GradeKeys = {
  maxKeys: ["Grade 9.8", "CGC 9.8", "CBCS 9.8"],
  minKeys: ["Grade 8.0", "CGC 8.0", "Grade 9.0"],
  companies: ["CGC", "CBCS", "PGX", "Grade"],
};

/** The multiplier for a raw copy: the bucket at or below its estimated grade, or 1 when no grade is recorded. */
export function rawFactor(grade: string | null, settings: Pick<ComicSettings, "rawGradeMultipliers">): { factor: number; bucket: string | null } {
  const n = gradeNumber(grade);
  const table = { ...DEFAULT_SETTINGS.rawGradeMultipliers, ...settings.rawGradeMultipliers };
  if (n === null) return { factor: 1, bucket: null };
  const buckets = Object.keys(table)
    .map(Number)
    .filter((b) => Number.isFinite(b) && b <= n)
    .sort((a, b) => b - a);
  if (buckets.length === 0) return { factor: table[Object.keys(table).sort()[0]] ?? 1, bucket: null };
  const bucket = String(buckets[0]);
  return { factor: table[bucket] ?? table[buckets[0].toFixed(1)] ?? 1, bucket };
}

export function summarizeComics(args: { item: ItemRecord<Comic>; quotes: PriceQuote[]; errors: PriceError[]; settings: Settings<ComicSettings>; fetchedAt: string }): ComicSummary {
  const { item, quotes, errors, settings, fetchedAt } = args;
  const raw = rawFactor(item.grade, settings);
  const company = item.slabbed && item.gradingCompany !== "none" ? COMPANIES[item.gradingCompany] : null;
  const gradeKeys = item.slabbed ? gradeLookupKeys(company, item.grade, "Grade 10") : [];
  const summary = summarizeGraded({
    item,
    quotes,
    errors,
    fetchedAt,
    priority: ["pricecharting"],
    gradeMultipliers: { ...DEFAULT_SETTINGS.gradeMultipliers, ...settings.gradeMultipliers },
    owner: {
      gradeKeys,
      conditionMultiplier: raw.factor,
      conditionLabel: raw.bucket ? `a raw copy around ${item.grade} (${raw.bucket} bucket)` : "a raw copy with no grade estimate",
    },
  });
  // A value typed on the comic is the owner's last word, whatever grade it is.
  if (item.manualValue !== null && item.manualValue > 0) {
    return { ...summary, yourCopyValue: round2(item.manualValue), yourCopyBasis: "Your own price" };
  }
  if (item.signatureSeries && summary.yourCopyValue !== null && settings.signatureSeriesMultiplier !== 1) {
    summary.yourCopyValue = round2(summary.yourCopyValue * settings.signatureSeriesMultiplier);
    summary.yourCopyBasis = `${summary.yourCopyBasis.replace(/\.$/, "")} × ${settings.signatureSeriesMultiplier} for the witnessed signature.`;
  }
  return summary;
}

/** The graded prices in one line, highest grade first, for the Markdown value table. */
export function describeComics(summary: ComicSummary): string {
  const keys = Object.keys(summary.graded).sort((a, b) => (gradeNumber(b) ?? 0) - (gradeNumber(a) ?? 0));
  const parts = [...(summary.ungraded ? [`Raw ${money(summary.ungraded)}`] : []), ...keys.map((k) => `${k} ${money(summary.graded[k])}`)];
  if (parts.length === 0) return "";
  return `${parts.join(" · ")}${summary.gradedSource || summary.ungradedSource ? ` (${summary.gradedSource ?? summary.ungradedSource})` : ""}`;
}

export function gradingSettingsOf(settings: Settings<ComicSettings>): GradingSettings {
  return { gradingFee: settings.gradingFee, readyMinUpside: settings.readyMinUpside, readyMinUpsidePercent: settings.readyMinUpsidePercent };
}

/** The grade-or-wait series for a raw copy, against the grade the owner expects it to get. */
export function outlookFor(item: ItemRecord<Comic>, snapshots: Array<Pick<PriceSnapshot<ComicExtras>, "id" | "fetchedAt" | "summary">>, settings: Settings<ComicSettings>): OutlookPoint[] {
  if (item.slabbed) return [];
  return outlookSeries(snapshots, gradingSettingsOf(settings), item.grade, COMIC_GRADE_KEYS);
}

/** One alert the first time a raw copy clears the owner's "ready to grade" thresholds. */
export function gradeWindowAlert(args: { item: ItemRecord<Comic>; history: Array<Pick<PriceSnapshot<ComicExtras>, "id" | "fetchedAt" | "summary">>; next: ComicSummary; settings: Settings<ComicSettings> }): NewAlert[] {
  const { item, history, next, settings } = args;
  if (item.slabbed || item.quantity <= 0) return [];
  const grading = gradingSettingsOf(settings);
  const before = outlookSeries(history, grading, item.grade, COMIC_GRADE_KEYS);
  const after = [...before, ...outlookSeries([{ id: Number.MAX_SAFE_INTEGER, fetchedAt: next.fetchedAt, summary: next }], grading, item.grade, COMIC_GRADE_KEYS)];
  const wasReady = before.length > 0 && isReadyToGrade(before, gradingVerdict(before), grading);
  const ready = isReadyToGrade(after, gradingVerdict(after), grading);
  if (!ready || wasReady) return [];
  const last = after[after.length - 1];
  return [
    {
      kind: "grade_window",
      itemId: item.id,
      title: `Good time to grade: ${item.title} #${item.issueNumber}`,
      body: `A ${last.maxLabel} copy is worth ${money(last.max)} against ${money(last.raw)} raw; ${money(last.upside)} of upside after a ${money(last.fee)} fee, the widest it has been.`,
    },
  ];
}
