import type { Currency, PriceError, PriceQuote, PriceSummary } from "./spec";

/**
 * Reading back what the database holds, field by field.
 *
 * A restore installs rows this app never wrote: a backup from another version,
 * a database edited by hand, a file damaged in a copy. A stored price summary
 * that is not JSON, or is JSON of another shape (`null`, `[1]`, a quote that
 * is a number), used to be handed on as it stood, and the first page to read a
 * field of it threw: every page that listed that item answered 500. So a
 * stored row is read the way a request body is: each field is taken when it
 * is what it says, and anything else reads as nothing there.
 */

/** What a summary field beyond the base ones holds: a price, a source's name, or prices by key (grade, tier). */
export type StoredField = "number" | "text" | "prices";

/** The kind of every field an app's summary adds, so a stored one can be read back into that shape. */
export type SummaryFields<X extends object> = { [K in keyof X]-?: StoredField };

/** What a summary says when there was nothing readable in the stored row. */
export const UNREADABLE_SUMMARY_BASIS = "This recorded price could not be read";

const CURRENCIES: Record<Currency, true> = { USD: true, EUR: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Prices by key, each a finite number; anything else in the object is left out. */
export function readPrices(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  // fromEntries defines each key as the object's own, "__proto__" included, rather than assigning it.
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => finite(entry[1]) !== null));
}

/** Strings by key (a source's id for an item); anything else is left out. */
export function readTexts(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** One stored quote, or nothing when it names no source or a currency this app does not price in. */
function readQuote(value: unknown, fetchedAt: string): PriceQuote | null {
  if (!isRecord(value)) return null;
  const source = text(value.source);
  const currency = text(value.currency) ?? "USD";
  if (!source || !Object.hasOwn(CURRENCIES, currency)) return null;
  const quote: PriceQuote = {
    source,
    sourceLabel: text(value.sourceLabel) ?? source,
    currency: currency as Currency,
    url: text(value.url),
    matchedName: text(value.matchedName) ?? "",
    matchedDetail: text(value.matchedDetail),
    price: finite(value.price),
    prices: readPrices(value.prices),
    fetchedAt: text(value.fetchedAt) ?? fetchedAt,
  };
  const externalId = text(value.externalId);
  if (externalId !== null) quote.externalId = externalId;
  if ("referenceImageUrl" in value) quote.referenceImageUrl = text(value.referenceImageUrl);
  return quote;
}

function readError(value: unknown): PriceError | null {
  if (!isRecord(value)) return null;
  const source = text(value.source);
  const message = text(value.message);
  return source !== null && message !== null ? { source, message } : null;
}

/**
 * A stored price summary as the app's own shape: the base fields every summary
 * has, and the app's own fields as `fields` names them. `fetchedAt` is the
 * row's own time, used when the summary does not carry one.
 */
export function readStoredSummary<X extends object>(raw: unknown, fetchedAt: string, fields: SummaryFields<X>): PriceSummary<X> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const stored = isRecord(parsed) ? parsed : null;
  const at = (stored && text(stored.fetchedAt)) || fetchedAt;
  const extras: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(fields) as Array<[string, StoredField]>) {
    const value = stored?.[key];
    extras[key] = kind === "prices" ? readPrices(value) : kind === "number" ? finite(value) : text(value);
  }
  return {
    currency: "USD",
    fetchedAt: at,
    yourCopyValue: stored ? finite(stored.yourCopyValue) : null,
    yourCopyBasis: stored ? (text(stored.yourCopyBasis) ?? "") : UNREADABLE_SUMMARY_BASIS,
    quotes: stored && Array.isArray(stored.quotes) ? stored.quotes.flatMap((q) => readQuote(q, at) ?? []) : [],
    errors: stored && Array.isArray(stored.errors) ? stored.errors.flatMap((e) => readError(e) ?? []) : [],
    ...extras,
  } as PriceSummary<X>;
}
