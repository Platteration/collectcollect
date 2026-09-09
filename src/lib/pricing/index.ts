import type { CardRecord, PriceQuote, PriceSource, PriceSummary, Settings } from "../types";
import type { CardQuery, PriceProvider } from "./types";
import { ProviderError } from "./types";
import { priceChartingProvider } from "./providers/pricecharting";
import { pokemonTcgProvider } from "./providers/pokemontcg";
import { ygoprodeckProvider } from "./providers/ygoprodeck";
import { scryfallProvider } from "./providers/scryfall";
import { round2 } from "./match";

/** Priority order: sources listed first win when several report an ungraded price. */
export const PROVIDERS: PriceProvider[] = [
  priceChartingProvider,
  pokemonTcgProvider,
  scryfallProvider,
  ygoprodeckProvider,
];

export function providersFor(game: CardQuery["game"]): PriceProvider[] {
  return PROVIDERS.filter((p) => p.games.includes(game) && p.isConfigured());
}

export interface ManualPrices {
  ungraded?: number | null;
  graded?: Record<string, number>;
}

/** Run every applicable provider; a failing provider becomes an error entry, never a thrown exception. */
export async function fetchQuotes(
  query: CardQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<{ quotes: PriceQuote[]; errors: PriceSummary["errors"] }> {
  const results = await Promise.allSettled(
    providersFor(query.game).map(async (p) => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ProviderError(p.id, `${p.label} timed out`)), 20_000),
      );
      return Promise.race([p.lookup(query, fetchImpl), timeout]);
    }),
  );
  const quotes: PriceQuote[] = [];
  const errors: PriceSummary["errors"] = [];
  const active = providersFor(query.game);
  results.forEach((r, i) => {
    if (r.status === "fulfilled") quotes.push(...r.value);
    else {
      const err = r.reason;
      errors.push({
        source: err instanceof ProviderError ? err.source : active[i].id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
  return { quotes, errors };
}

const SOURCE_PRIORITY: PriceSource[] = ["manual", "pricecharting", "pokemontcg", "scryfall", "ygoprodeck"];

function manualQuote(manual: ManualPrices | undefined, fetchedAt: string): PriceQuote | null {
  const graded = Object.fromEntries(
    Object.entries(manual?.graded ?? {}).filter(([, v]) => Number.isFinite(v) && v > 0),
  );
  const ungraded = manual?.ungraded && manual.ungraded > 0 ? manual.ungraded : null;
  if (!ungraded && Object.keys(graded).length === 0) return null;
  return {
    source: "manual",
    sourceLabel: "Manual entry",
    currency: "USD",
    url: null,
    matchedName: "Your own price",
    matchedDetail: null,
    ungraded,
    ungradedVariants: {},
    graded,
    fetchedAt,
  };
}

/** Normalize grade labels: "psa 10", "PSA10" -> "PSA 10"; "9.5" alone -> "Grade 9.5". */
export function gradeKey(company: string | null | undefined, grade: string | null | undefined): string | null {
  const g = (grade ?? "").trim().replace(/^grade\s*/i, "");
  if (!g) return null;
  const c = (company ?? "").trim().toUpperCase();
  const digits = g.replace(/[^0-9.]/g, "");
  // "10.0" and "9.50" are the same grades as "10" and "9.5"; a trailing zero
  // would otherwise miss every price a source publishes.
  const gnum = digits && Number.isFinite(Number(digits)) ? String(Number(digits)) : digits || g;
  return c && c !== "OTHER" ? `${c} ${gnum}` : `Grade ${gnum}`;
}

/** Which keys to try, in order, when looking up a graded price for the owner's copy. */
export function gradeLookupKeys(company: string | null | undefined, grade: string | null | undefined): string[] {
  const primary = gradeKey(company, grade);
  if (!primary) return [];
  const gnum = primary.split(" ").slice(1).join(" ");
  const keys = [primary];
  if (!primary.startsWith("Grade ")) keys.push(`Grade ${gnum}`);
  // PriceCharting reports grade 9 / 9.5 generically; treat a 10 from any company as comparable to PSA 10 last.
  if (gnum === "10" && primary !== "PSA 10") keys.push("PSA 10");
  return keys;
}

export interface OwnerCopy {
  condition: CardRecord["condition"];
  gradingCompany: string | null;
  grade: string | null;
}

/** Combine quotes into the summary the UI displays. Pure: no network. */
export function summarize(
  quotes: PriceQuote[],
  errors: PriceSummary["errors"],
  settings: Settings,
  owner: OwnerCopy,
  manual?: ManualPrices,
  fetchedAt = new Date().toISOString(),
): PriceSummary {
  const all = [...quotes];
  const m = manualQuote(manual, fetchedAt);
  if (m) all.unshift(m);

  const byPriority = [...all].sort(
    (a, b) => SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source),
  );
  const ungradedQuote = byPriority.find((q) => q.currency === "USD" && q.ungraded);
  const ungraded = ungradedQuote?.ungraded ?? null;

  // Graded prices: manual overrides win per key, then the first real graded source.
  const graded: Record<string, number> = {};
  let gradedSource: string | null = null;
  for (const q of byPriority) {
    if (q.currency !== "USD" || Object.keys(q.graded).length === 0) continue;
    for (const [k, v] of Object.entries(q.graded)) if (!(k in graded)) graded[k] = v;
    if (!gradedSource) gradedSource = q.sourceLabel;
    else if (q.source !== "manual" && gradedSource === "Manual entry") gradedSource = `Manual entry + ${q.sourceLabel}`;
  }

  const estimatedGraded: Record<string, number> = {};
  if (ungraded) {
    for (const [k, mult] of Object.entries(settings.gradeMultipliers)) {
      if (!(k in graded)) estimatedGraded[k] = round2(ungraded * mult);
    }
  }

  let yourCopyValue: number | null = null;
  let yourCopyBasis = "No price available yet.";
  const gradedOwner = Boolean(owner.grade);
  if (gradedOwner) {
    const keys = gradeLookupKeys(owner.gradingCompany, owner.grade);
    const hit = keys.find((k) => k in graded);
    if (hit) {
      yourCopyValue = graded[hit];
      yourCopyBasis = `${hit} price from ${gradedSource}.`;
    } else {
      const est = keys.find((k) => k in estimatedGraded);
      if (est) {
        yourCopyValue = estimatedGraded[est];
        yourCopyBasis = `Estimated: ungraded price × ${settings.gradeMultipliers[est]} (${est} multiplier from Settings).`;
      } else if (ungraded) {
        yourCopyValue = ungraded;
        yourCopyBasis = `No graded data or multiplier for ${keys[0] ?? "this grade"}; showing the ungraded price.`;
      }
    }
  } else if (ungraded) {
    const mult = settings.conditionMultipliers[owner.condition] ?? 1;
    yourCopyValue = round2(ungraded * mult);
    yourCopyBasis =
      mult === 1
        ? `Ungraded market price from ${ungradedQuote?.sourceLabel}.`
        : `Ungraded price × ${mult} for ${owner.condition} condition (from Settings).`;
  }

  return {
    currency: "USD",
    fetchedAt,
    ungraded,
    ungradedSource: ungradedQuote?.sourceLabel ?? null,
    graded,
    gradedSource,
    estimatedGraded,
    yourCopyValue,
    yourCopyBasis,
    quotes: all,
    errors,
  };
}

export function cardToQuery(card: Pick<CardRecord, "game" | "name" | "sport" | "setName" | "setCode" | "cardNumber" | "year" | "variant" | "manufacturer" | "externalIds">): CardQuery {
  return {
    game: card.game,
    name: card.name,
    sport: card.sport,
    setName: card.setName,
    setCode: card.setCode,
    cardNumber: card.cardNumber,
    year: card.year,
    variant: card.variant,
    manufacturer: card.manufacturer,
    externalIds: card.externalIds,
  };
}

/** Full pipeline for one card: providers -> summary. */
export async function priceCard(
  card: CardRecord,
  settings: Settings,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceSummary> {
  const { quotes, errors } = await fetchQuotes(cardToQuery(card), fetchImpl);
  return summarize(
    quotes,
    errors,
    settings,
    { condition: card.condition, gradingCompany: card.gradingCompany, grade: card.grade },
    { ungraded: card.manualUngraded, graded: card.manualGraded },
  );
}

/** External ids and reference images learned from quotes, to persist on the card. */
export function learnFromQuotes(quotes: PriceQuote[]): { externalIds: Record<string, string>; referenceImageUrl: string | null } {
  const externalIds: Record<string, string> = {};
  let referenceImageUrl: string | null = null;
  for (const q of quotes) {
    if (q.externalId && q.source !== "manual") externalIds[q.source] = q.externalId;
    if (!referenceImageUrl && q.referenceImageUrl) referenceImageUrl = q.referenceImageUrl;
  }
  return { externalIds, referenceImageUrl };
}
