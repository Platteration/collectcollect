import { MANUAL_SOURCE, byPriority, manualQuote, type GradedExtras } from "@collectcollect/core/domain/pricing/index";
import { gradingVerdict, isReadyToGrade, outlookSeries, type GradeKeys, type GradingSettings, type OutlookPoint } from "@collectcollect/core/grading";
import { round2 } from "@collectcollect/core/pricing/match";
import type { ItemRecord, NewAlert, PriceError, PriceQuote, PriceSnapshot, PriceSummary, Settings } from "@collectcollect/core/domain/spec";
import { money } from "@collectcollect/core/format";
import { COMPLETENESS, CONDITIONS, DEFAULT_SETTINGS, TIER_KEY, type Completeness, type Game, type GameSettings } from "../types";

/**
 * What a copy is worth, from what the sources said about the game.
 *
 * A game has a price per completeness (loose, CIB, sealed) and, above those,
 * a graded price. A copy reads the price of its own tier and scales it by the
 * condition of what it consists of; a graded copy reads the graded price, or
 * an estimate from the sealed price when no graded sale is known. The result
 * carries the same graded/estimated shape the card app uses, so the
 * grade-or-wait verdict works on a sealed game unchanged.
 */

export interface GameExtras extends GradedExtras {
  /** Every completeness price the sources reported: Loose, CIB, New, Graded, box and manual alone. */
  tiers: Record<string, number>;
  tiersSource: string | null;
}

export type GameSummary = PriceSummary<GameExtras>;

/** Which recorded prices name the best graded outcome; a game has one graded figure, not one per grade. */
export const GAME_GRADE_KEYS: GradeKeys = { maxKeys: ["Graded"], minKeys: [], companies: ["WATA", "VGA", "CGC", "Grade"] };

/** The tier a graded copy would read as raw: it was sealed unless a manual or cartridge grade says it was complete-in-box. */
export function rawTier(item: Pick<Game, "completeness" | "manualCondition" | "mediaCondition">): string {
  if (item.completeness !== "graded") return TIER_KEY[item.completeness];
  return item.manualCondition || item.mediaCondition ? "CIB" : "New";
}

/**
 * How condition scales a tier price: the cartridge or disc for a loose copy,
 * the box for a sealed one, and the worst of box, manual and media for a
 * complete one, since a complete copy sells at the grade of its weakest part.
 */
export function conditionFactor(item: Pick<Game, "completeness" | "boxCondition" | "manualCondition" | "mediaCondition">, settings: Pick<GameSettings, "conditionMultipliers">): { factor: number; label: string } {
  const multipliers = { ...DEFAULT_SETTINGS.conditionMultipliers, ...settings.conditionMultipliers };
  const parts: Array<[string, string | null]> =
    item.completeness === "loose"
      ? [["cartridge", item.mediaCondition]]
      : item.completeness === "sealed"
        ? [["box", item.boxCondition]]
        : item.completeness === "cib"
          ? [
              ["box", item.boxCondition],
              ["manual", item.manualCondition],
              ["cartridge", item.mediaCondition],
            ]
          : [];
  let worst: { factor: number; label: string } | null = null;
  for (const [what, condition] of parts) {
    if (!condition) continue;
    const factor = multipliers[condition] ?? 1;
    if (!worst || factor < worst.factor) worst = { factor, label: `${CONDITIONS[condition as keyof typeof CONDITIONS] ?? condition} ${what}` };
  }
  return worst ?? { factor: 1, label: "condition not recorded" };
}

export function summarizeGames(args: { item: ItemRecord<Game>; quotes: PriceQuote[]; errors: PriceError[]; settings: Settings<GameSettings>; fetchedAt: string }): GameSummary {
  const { item, quotes, errors, settings, fetchedAt } = args;
  const manual = manualQuote(item, fetchedAt);
  const sources = byPriority(
    quotes.filter((q) => q.currency === "USD" && q.source !== MANUAL_SOURCE),
    ["pricecharting"],
  );

  // Every named price, the owner's own entries winning per key.
  const tiers: Record<string, number> = {};
  let tiersSource: string | null = null;
  for (const q of [...(manual ? [manual] : []), ...sources]) {
    for (const [k, v] of Object.entries(q.prices)) {
      if (!Object.hasOwn(tiers, k)) tiers[k] = v;
    }
    if (Object.keys(q.prices).length && !tiersSource) tiersSource = q.sourceLabel;
  }
  const priceSource = (key: string): string | null => {
    if (manual && Object.hasOwn(manual.prices, key)) return manual.sourceLabel;
    return sources.find((q) => Object.hasOwn(q.prices, key))?.sourceLabel ?? null;
  };

  const raw = rawTier(item);
  const ungraded = tiers[raw] ?? null;
  const graded: Record<string, number> = {};
  if (tiers.Graded) graded.Graded = tiers.Graded;
  const multipliers = { ...DEFAULT_SETTINGS.gradeMultipliers, ...settings.gradeMultipliers };
  const estimatedGraded: Record<string, number> = {};
  if (!graded.Graded && ungraded && multipliers[raw]) estimatedGraded.Graded = round2(ungraded * multipliers[raw]);

  let yourCopyValue: number | null = null;
  let yourCopyBasis: string;
  if (manual?.price) {
    yourCopyValue = round2(manual.price);
    yourCopyBasis = "Your own price";
  } else if (item.completeness === "graded") {
    if (graded.Graded) {
      yourCopyValue = graded.Graded;
      yourCopyBasis = `Graded price from ${priceSource("Graded")}`;
    } else if (estimatedGraded.Graded) {
      yourCopyValue = estimatedGraded.Graded;
      yourCopyBasis = `Estimated: ${raw} price × ${multipliers[raw]} (graded multiplier from Settings)`;
    } else if (ungraded) {
      yourCopyValue = ungraded;
      yourCopyBasis = `No graded price known; showing the ${raw} price from ${priceSource(raw)}`;
    } else {
      yourCopyBasis = errors.length ? "No price: every source failed" : "No source has a price for this yet";
    }
  } else if (ungraded) {
    const condition = conditionFactor(item, settings);
    yourCopyValue = round2(ungraded * condition.factor);
    yourCopyBasis =
      condition.factor === 1
        ? `${priceSource(raw)} ${raw} price for a ${COMPLETENESS[item.completeness as Completeness].toLowerCase()} copy`
        : `${priceSource(raw)} ${raw} price × ${condition.factor} for a ${condition.label}`;
  } else {
    yourCopyBasis = errors.length ? "No price: every source failed" : "No source has a price for this yet";
  }

  return {
    currency: "USD",
    fetchedAt,
    yourCopyValue,
    yourCopyBasis,
    quotes: manual ? [manual, ...quotes] : quotes,
    errors,
    ungraded,
    ungradedSource: ungraded === null ? null : priceSource(raw),
    graded,
    gradedSource: graded.Graded ? priceSource("Graded") : null,
    estimatedGraded,
    tiers,
    tiersSource,
  };
}

/** The tier prices in one line, for the Markdown value table. */
export function describeGames(summary: GameSummary): string {
  const parts = ["Loose", "CIB", "New", "Graded"].filter((k) => summary.tiers[k]).map((k) => `${k} ${money(summary.tiers[k])}`);
  if (parts.length === 0) return "";
  return `${parts.join(" · ")}${summary.tiersSource ? ` (${summary.tiersSource})` : ""}`;
}

export function gradingSettingsOf(settings: Settings<GameSettings>): GradingSettings {
  return { gradingFee: settings.gradingFee, readyMinUpside: settings.readyMinUpside, readyMinUpsidePercent: settings.readyMinUpsidePercent };
}

/** Whether a copy is something one would send to be graded: complete or sealed, and not already in a case. */
export function gradeable(item: Pick<Game, "completeness">): boolean {
  return item.completeness === "sealed" || item.completeness === "cib";
}

/** The grade-or-wait series for a raw copy, from its recorded prices. */
export function outlookFor(item: ItemRecord<Game>, snapshots: Array<Pick<PriceSnapshot<GameExtras>, "id" | "fetchedAt" | "summary">>, settings: Settings<GameSettings>): OutlookPoint[] {
  if (!gradeable(item)) return [];
  return outlookSeries(snapshots, gradingSettingsOf(settings), null, GAME_GRADE_KEYS);
}

/** An alert the moment a sealed or complete copy first clears the owner's "ready to grade" thresholds. */
export function gradeWindowAlert(args: { item: ItemRecord<Game>; history: Array<Pick<PriceSnapshot<GameExtras>, "id" | "fetchedAt" | "summary">>; next: GameSummary; settings: Settings<GameSettings> }): NewAlert[] {
  const { item, history, next, settings } = args;
  if (!gradeable(item) || item.quantity <= 0) return [];
  const grading = gradingSettingsOf(settings);
  const before = outlookSeries(history, grading, null, GAME_GRADE_KEYS);
  const after = [...before, ...outlookSeries([{ id: Number.MAX_SAFE_INTEGER, fetchedAt: next.fetchedAt, summary: next }], grading, null, GAME_GRADE_KEYS)];
  const wasReady = before.length > 0 && isReadyToGrade(before, gradingVerdict(before), grading);
  const ready = isReadyToGrade(after, gradingVerdict(after), grading);
  if (!ready || wasReady) return [];
  const last = after[after.length - 1];
  return [
    {
      kind: "grade_window",
      itemId: item.id,
      title: `Good time to grade: ${item.title}`,
      body: `A ${last.maxLabel.toLowerCase()} copy is worth ${money(last.max)} against ${money(last.raw)} raw; ${money(last.upside)} of upside after a ${money(last.fee)} fee, the widest it has been.`,
    },
  ];
}
