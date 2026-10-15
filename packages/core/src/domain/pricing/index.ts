import { round2 } from "../../pricing/match";
import type { ItemRecord, PriceError, PriceProvider, PriceQuote, PriceSummary, PriceSummaryBase, ProviderStatus, Valuation } from "../spec";
import { ProviderError } from "../spec";

/**
 * Asking every source about one item, and folding the answers together.
 *
 * Two summarisers are provided. `summarizeSimple` is for things with one
 * going rate (a watch, a bottle): a value typed in by hand wins, otherwise
 * the first source in priority order that answered. `summarizeGraded` is
 * for things priced by grade (a game, a comic, a card): an ungraded price,
 * real graded prices keyed by grade, estimates from multipliers where there
 * are none, and what the owner's own copy is worth at its grade or condition.
 */

export async function fetchQuotes<Q>(
  providers: PriceProvider<Q>[],
  query: Q,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<{ quotes: PriceQuote[]; errors: PriceError[] }> {
  const active = providers.filter((p) => p.isConfigured());
  const results = await Promise.allSettled(
    active.map(async (p) => {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new ProviderError(p.id, `${p.label} timed out`)), timeoutMs));
      return Promise.race([p.lookup(query, fetchImpl), timeout]);
    }),
  );
  const quotes: PriceQuote[] = [];
  const errors: PriceError[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") quotes.push(...r.value);
    else {
      const err = r.reason;
      errors.push({ source: err instanceof ProviderError ? err.source : active[i].id, message: err instanceof Error ? err.message : String(err) });
    }
  });
  return { quotes, errors };
}

/** Load whatever can be loaded once for a whole run; failures are returned, not thrown. */
export async function primeProviders<Q>(providers: PriceProvider<Q>[], fetchImpl: typeof fetch = fetch): Promise<PriceError[]> {
  const errors: PriceError[] = [];
  await Promise.all(
    providers
      .filter((p) => p.isConfigured() && p.prime)
      .map(async (p) => {
        try {
          await p.prime!(fetchImpl);
        } catch (e) {
          errors.push({ source: p.label, message: e instanceof Error ? e.message : String(e) });
        }
      }),
  );
  return errors;
}

export const MANUAL_SOURCE = "manual";

/** The owner's own prices as a quote, so they sit beside the sources and win. */
export function manualQuote(item: Pick<ItemRecord, "manualValue" | "manualPrices">, fetchedAt: string): PriceQuote | null {
  const prices = Object.fromEntries(Object.entries(item.manualPrices ?? {}).filter(([, v]) => Number.isFinite(v) && v > 0));
  const price = item.manualValue !== null && item.manualValue > 0 ? item.manualValue : null;
  if (price === null && Object.keys(prices).length === 0) return null;
  return {
    source: MANUAL_SOURCE,
    sourceLabel: "Your own price",
    currency: "USD",
    url: null,
    matchedName: "Entered by hand",
    matchedDetail: null,
    price,
    prices,
    fetchedAt,
  };
}

export function byPriority(quotes: PriceQuote[], priority: string[]): PriceQuote[] {
  const rank = (source: string) => {
    if (source === MANUAL_SOURCE) return -1;
    const i = priority.indexOf(source);
    return i === -1 ? priority.length : i;
  };
  return [...quotes].sort((a, b) => rank(a.source) - rank(b.source));
}

export interface SimpleExtras {
  /** The going rate from the sources, ignoring any price typed in by hand. */
  market: number | null;
  marketSource: string | null;
}

/** Manual value first, then the first source in priority order with a USD price. */
export function summarizeSimple(args: {
  item: Pick<ItemRecord, "manualValue" | "manualPrices">;
  quotes: PriceQuote[];
  errors: PriceError[];
  fetchedAt: string;
  priority: string[];
  /** How the value came about when a source answered, e.g. "Chrono24 median listing". */
  basisFor?: (quote: PriceQuote) => string;
}): PriceSummary<SimpleExtras> {
  const { item, quotes, errors, fetchedAt, priority } = args;
  const manual = manualQuote(item, fetchedAt);
  const ordered = byPriority(quotes, priority);
  const marketQuote = ordered.find((q) => q.currency === "USD" && q.price !== null && q.source !== MANUAL_SOURCE) ?? null;
  const market = marketQuote?.price ?? null;

  let yourCopyValue: number | null = null;
  let yourCopyBasis: string;
  if (manual?.price) {
    yourCopyValue = round2(manual.price);
    yourCopyBasis = "Your own price";
  } else if (market !== null && marketQuote) {
    yourCopyValue = round2(market);
    yourCopyBasis = args.basisFor ? args.basisFor(marketQuote) : `${marketQuote.sourceLabel}`;
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
    market: market === null ? null : round2(market),
    marketSource: marketQuote?.sourceLabel ?? null,
  };
}

export interface GradedExtras {
  ungraded: number | null;
  ungradedSource: string | null;
  graded: Record<string, number>;
  gradedSource: string | null;
  /** Estimates derived from the ungraded price via settings multipliers. */
  estimatedGraded: Record<string, number>;
}

export type GradedPriceSummary = PriceSummary<GradedExtras>;

/** Normalize grade labels: "psa 10", "PSA10" -> "PSA 10"; "9.5" alone -> "Grade 9.5". */
export function gradeKey(company: string | null | undefined, grade: string | null | undefined): string | null {
  const g = (grade ?? "").trim().replace(/^grade\s*/i, "");
  if (!g) return null;
  const c = (company ?? "").trim().toUpperCase();
  const digits = g.replace(/[^0-9.]/g, "");
  const gnum = digits && Number.isFinite(Number(digits)) ? String(Number(digits)) : digits || g;
  return c && c !== "OTHER" && c !== "NONE" ? `${c} ${gnum}` : `Grade ${gnum}`;
}

/** Which keys to try, in order, when looking up a graded price for the owner's copy. */
export function gradeLookupKeys(company: string | null | undefined, grade: string | null | undefined, topKey = "PSA 10"): string[] {
  const primary = gradeKey(company, grade);
  if (!primary) return [];
  const gnum = primary.split(" ").slice(1).join(" ");
  const keys = [primary];
  if (!primary.startsWith("Grade ")) keys.push(`Grade ${gnum}`);
  if (gnum === "10" && primary !== topKey) keys.push(topKey);
  return keys;
}

export function summarizeGraded(args: {
  item: Pick<ItemRecord, "manualValue" | "manualPrices">;
  quotes: PriceQuote[];
  errors: PriceError[];
  fetchedAt: string;
  priority: string[];
  gradeMultipliers: Record<string, number>;
  /** How the owner's copy is held: keys to look up when graded, a multiplier when raw. */
  owner: { gradeKeys: string[]; conditionMultiplier: number; conditionLabel: string };
  /** Which of a quote's named prices are graded prices; the rest are ignored here. Default: all. */
  isGradeKey?: (key: string) => boolean;
}): GradedPriceSummary {
  const { item, quotes, errors, fetchedAt, priority, gradeMultipliers, owner } = args;
  const isGrade = args.isGradeKey ?? (() => true);
  const manual = manualQuote(item, fetchedAt);
  const all = manual ? [manual, ...quotes] : [...quotes];
  const ordered = byPriority(all, priority);
  const ungradedQuote = ordered.find((q) => q.currency === "USD" && q.price);
  const ungraded = ungradedQuote?.price ?? null;

  // Graded prices: manual entries win per key, then the first real graded source.
  const graded: Record<string, number> = {};
  let gradedSource: string | null = null;
  for (const q of ordered) {
    if (q.currency !== "USD") continue;
    const entries = Object.entries(q.prices).filter(([k]) => isGrade(k));
    if (entries.length === 0) continue;
    for (const [k, v] of entries) if (!Object.hasOwn(graded, k)) graded[k] = v;
    if (!gradedSource) gradedSource = q.sourceLabel;
    else if (q.source !== MANUAL_SOURCE && gradedSource === "Your own price") gradedSource = `Your own price + ${q.sourceLabel}`;
  }

  const estimatedGraded: Record<string, number> = {};
  if (ungraded) {
    for (const [k, mult] of Object.entries(gradeMultipliers)) {
      if (!Object.hasOwn(graded, k)) estimatedGraded[k] = round2(ungraded * mult);
    }
  }

  let yourCopyValue: number | null = null;
  let yourCopyBasis = "No price available yet.";
  if (owner.gradeKeys.length) {
    const hit = owner.gradeKeys.find((k) => k in graded);
    if (hit) {
      yourCopyValue = graded[hit];
      yourCopyBasis = `${hit} price from ${gradedSource}.`;
    } else {
      const est = owner.gradeKeys.find((k) => k in estimatedGraded);
      if (est) {
        yourCopyValue = estimatedGraded[est];
        yourCopyBasis = `Estimated: ungraded price × ${gradeMultipliers[est]} (${est} multiplier from Settings).`;
      } else if (ungraded) {
        yourCopyValue = ungraded;
        yourCopyBasis = `No graded data or multiplier for ${owner.gradeKeys[0]}; showing the ungraded price.`;
      }
    }
  } else if (ungraded) {
    yourCopyValue = round2(ungraded * owner.conditionMultiplier);
    yourCopyBasis =
      owner.conditionMultiplier === 1
        ? `${ungradedQuote?.sourceLabel} price for ${owner.conditionLabel}.`
        : `${ungradedQuote?.sourceLabel} price × ${owner.conditionMultiplier} for ${owner.conditionLabel} (from Settings).`;
  } else if (errors.length) {
    yourCopyBasis = "No price: every source failed.";
  }

  return {
    currency: "USD",
    fetchedAt,
    yourCopyValue,
    yourCopyBasis,
    quotes: all,
    errors,
    ungraded,
    ungradedSource: ungradedQuote?.sourceLabel ?? null,
    graded,
    gradedSource,
    estimatedGraded,
  };
}

/** External ids and reference images learned from quotes, to persist on the item. */
export function learnFromQuotes(quotes: PriceQuote[]): { externalIds: Record<string, string>; referenceImageUrl: string | null } {
  const externalIds: Record<string, string> = {};
  let referenceImageUrl: string | null = null;
  for (const q of quotes) {
    if (q.externalId && q.source !== MANUAL_SOURCE) externalIds[q.source] = q.externalId;
    if (!referenceImageUrl && q.referenceImageUrl) referenceImageUrl = q.referenceImageUrl;
  }
  return { externalIds, referenceImageUrl };
}

/** What one copy is worth now: a value typed in by hand, else the last recorded value, else nothing. */
export function defaultValueOf(item: Pick<ItemRecord, "manualValue">, snapshot: { summary: PriceSummaryBase } | null | undefined): Valuation {
  if (item.manualValue !== null && item.manualValue > 0) return { value: item.manualValue, basis: "Your own price" };
  const recorded = snapshot?.summary.yourCopyValue ?? null;
  if (recorded === null) return { value: null, basis: "Not priced yet" };
  return { value: recorded, basis: snapshot!.summary.yourCopyBasis || "Last recorded price" };
}

/** A manual-entry source, listed in Settings so a missing price is never mistaken for a missing market. */
export function manualProvider<Q>(note: string): PriceProvider<Q> {
  return {
    id: MANUAL_SOURCE,
    label: "Your own price",
    optional: false,
    note,
    isConfigured: () => true,
    async lookup() {
      // The owner's prices are read from the item itself by the summariser.
      return [];
    },
  };
}

export function providerStatuses<Q>(providers: PriceProvider<Q>[]): ProviderStatus[] {
  return providers.map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured(), optional: p.optional, note: p.note }));
}
