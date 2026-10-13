import type { Currency, PriceQuote, PriceSource, PriceSummary } from "./types";

/**
 * A stored price summary read back field by field.
 *
 * The database is not only written by this app: a restore installs a whole
 * file someone else may have made, and the readers index straight into a
 * summary (`summary.graded["PSA 10"]`, `summary.quotes.filter`, each quote's
 * `graded`). A summary that was an object but not one of these — `{}`, or a
 * `graded` that was a string — once took the portfolio, the card's page and
 * the CSV export down with a 500 on every load, until the card got a new
 * price. Each field now falls back on its own: a figure that is not a finite
 * number reads as not known, a table that is not one reads as empty, a quote
 * or an error that is not an object is left out. A summary this app wrote
 * comes back exactly as it was written. Not an object at all is null, which
 * the callers already drop.
 */
export function readPriceSummary(raw: unknown, fetchedAt: string): PriceSummary | null {
  if (!isRecord(raw)) return null;
  const at = text(raw.fetchedAt) ?? fetchedAt;
  const summary: PriceSummary = {
    currency: "USD",
    fetchedAt: at,
    ungraded: figure(raw.ungraded),
    ungradedSource: text(raw.ungradedSource),
    graded: prices(raw.graded),
    gradedSource: text(raw.gradedSource),
    estimatedGraded: prices(raw.estimatedGraded),
    yourCopyValue: figure(raw.yourCopyValue),
    yourCopyBasis: text(raw.yourCopyBasis) ?? "",
    quotes: Array.isArray(raw.quotes) ? raw.quotes.flatMap((q) => readQuote(q, at)) : [],
    errors: Array.isArray(raw.errors)
      ? raw.errors.flatMap((e) => (isRecord(e) ? [{ source: text(e.source) ?? "", message: text(e.message) ?? "" }] : []))
      : [],
  };
  const recomputedAt = text(raw.recomputedAt);
  if (recomputedAt !== null) summary.recomputedAt = recomputedAt;
  if (isRecord(raw.gradedSources)) {
    const sources = Object.fromEntries(
      Object.entries(raw.gradedSources).flatMap(([grade, list]) =>
        Array.isArray(list)
          ? [[grade, list.flatMap((entry) => {
              const source = isRecord(entry) ? text(entry.source) : null;
              const price = isRecord(entry) ? figure(entry.price) : null;
              return source !== null && price !== null ? [{ source, price }] : [];
            })]]
          : [],
      ),
    );
    summary.gradedSources = sources;
  }
  return summary;
}

const SOURCES: Record<PriceSource, true> = { pricecharting: true, pokemontcg: true, ygoprodeck: true, scryfall: true, manual: true };
const CURRENCIES: Record<Currency, true> = { USD: true, EUR: true };

/** One stored quote, or nothing when it names no source this app has. */
function readQuote(raw: unknown, fetchedAt: string): PriceQuote[] {
  if (!isRecord(raw)) return [];
  const source = text(raw.source);
  if (source === null || !Object.hasOwn(SOURCES, source)) return [];
  const currency = text(raw.currency);
  const quote: PriceQuote = {
    source: source as PriceSource,
    sourceLabel: text(raw.sourceLabel) ?? source,
    currency: currency !== null && Object.hasOwn(CURRENCIES, currency) ? (currency as Currency) : "USD",
    url: text(raw.url),
    matchedName: text(raw.matchedName) ?? "",
    matchedDetail: text(raw.matchedDetail),
    ungraded: figure(raw.ungraded),
    ungradedVariants: prices(raw.ungradedVariants),
    graded: prices(raw.graded),
    fetchedAt: text(raw.fetchedAt) ?? fetchedAt,
  };
  const externalId = typeof raw.externalId === "number" && Number.isFinite(raw.externalId) ? String(raw.externalId) : text(raw.externalId);
  if (externalId !== null) quote.externalId = externalId;
  if (Object.hasOwn(raw, "referenceImageUrl")) quote.referenceImageUrl = text(raw.referenceImageUrl);
  return [quote];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function figure(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A table of prices — `{"PSA 10": 500}` — keeping the entries that are numbers. */
function prices(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => figure(entry[1]) !== null));
}
