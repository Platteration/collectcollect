import type { Currency, PriceQuote, PriceSource, PriceSummary } from "./types";

/**
 * A stored price summary read back field by field.
 *
 * The database is not only written by this app: a restore installs a whole
 * file someone else may have made, and the pages read straight into a summary
 * (`summary.yourCopyValue`, every quote's market). A summary that was `null`,
 * `1`, `[]` or an object without its quotes took the "Where to sell" page down
 * with a 500 on every load until the item got a new price, and a quote naming
 * a market this app does not have would have done the same through its table
 * of markets. Each field now falls back on its own: a figure that is not a
 * finite number reads as not known, a quote or an error that is not an object,
 * or names no market here, is left out. A summary this app wrote comes back
 * exactly as it was written. Not an object at all is null, and the snapshot
 * is passed over.
 */
export function readPriceSummary(raw: unknown, fetchedAt: string): PriceSummary | null {
  if (!isRecord(raw)) return null;
  const at = text(raw.fetchedAt) ?? fetchedAt;
  const summary: PriceSummary = {
    currency: "USD",
    fetchedAt: at,
    market: figure(raw.market),
    marketSource: text(raw.marketSource),
    yourCopyValue: figure(raw.yourCopyValue),
    yourCopyBasis: text(raw.yourCopyBasis) ?? "",
    quotes: Array.isArray(raw.quotes) ? raw.quotes.flatMap((q) => readQuote(q, at)) : [],
    errors: Array.isArray(raw.errors)
      ? raw.errors.flatMap((e) => (isRecord(e) ? [{ source: text(e.source) ?? "", message: text(e.message) ?? "" }] : []))
      : [],
  };
  // Absent on a snapshot from before it was recorded, which the alerts read as such.
  if (raw.valueBasis === "cash" || raw.valueBasis === "wallet" || raw.valueBasis === "manual") summary.valueBasis = raw.valueBasis;
  return summary;
}

const SOURCES: Record<PriceSource, true> = { steam: true, skinport: true, csfloat: true, manual: true };
const CURRENCIES: Record<Currency, true> = { USD: true, EUR: true };

/** One stored quote, or nothing when it names no market this app has. */
function readQuote(raw: unknown, fetchedAt: string): PriceQuote[] {
  if (!isRecord(raw)) return [];
  const source = text(raw.source);
  if (source === null || !Object.hasOwn(SOURCES, source)) return [];
  const currency = text(raw.currency);
  return [{
    source: source as PriceSource,
    sourceLabel: text(raw.sourceLabel) ?? source,
    currency: currency !== null && Object.hasOwn(CURRENCIES, currency) ? (currency as Currency) : "USD",
    url: text(raw.url),
    matchedName: text(raw.matchedName) ?? "",
    price: figure(raw.price),
    volume: figure(raw.volume),
    fetchedAt: text(raw.fetchedAt) ?? fetchedAt,
  }];
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
