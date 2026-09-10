import type { ItemRecord, PriceQuote, PriceSummary, Settings } from "../types";
import { MARKETS, type Market } from "../types";
import { csfloat } from "./providers/csfloat";
import { skinport } from "./providers/skinport";
import { steam } from "./providers/steam";
import type { ItemQuery, PriceProvider } from "./types";

export const PROVIDERS: PriceProvider[] = [skinport, steam, csfloat];

/** Money, to the cent. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ask every configured source about one item.
 *
 * A source that fails becomes an entry in `errors` rather than an exception:
 * one market being down must not cost the answers the others gave, and a
 * silently missing source would be indistinguishable from a market that has
 * nobody selling.
 */
export async function fetchQuotes(
  query: ItemQuery,
  fetchImpl?: typeof fetch,
): Promise<{ quotes: PriceQuote[]; errors: Array<{ source: string; message: string }> }> {
  const quotes: PriceQuote[] = [];
  const errors: Array<{ source: string; message: string }> = [];
  const results = await Promise.all(
    PROVIDERS.filter((p) => p.isConfigured()).map(
      async (provider): Promise<{ provider: PriceProvider; quotes: PriceQuote[]; error?: undefined } | { provider: PriceProvider; error: string; quotes?: undefined }> => {
        try {
          return { provider, quotes: await provider.lookup(query, fetchImpl) };
        } catch (e) {
          return { provider, error: e instanceof Error ? e.message : String(e) };
        }
      },
    ),
  );
  for (const result of results) {
    if (result.error !== undefined) errors.push({ source: result.provider.label, message: result.error });
    else quotes.push(...result.quotes);
  }
  return { quotes, errors };
}

/**
 * Load whatever can be loaded once for a whole run.
 *
 * Priming failures are returned rather than thrown: a provider whose catalogue
 * would not load simply has nothing to say this time round, and the rest of the
 * refresh proceeds.
 */
export async function primeProviders(fetchImpl?: typeof fetch): Promise<Array<{ source: string; message: string }>> {
  const errors: Array<{ source: string; message: string }> = [];
  await Promise.all(
    PROVIDERS.filter((p) => p.isConfigured() && p.prime).map(async (provider) => {
      try {
        await provider.prime!(fetchImpl);
      } catch (e) {
        errors.push({ source: provider.label, message: e instanceof Error ? e.message : String(e) });
      }
    }),
  );
  return errors;
}

/**
 * What you would actually receive for something, on one market.
 *
 * The fee is the fraction of the buyer's price the seller does not get. Steam's
 * is charged on top of what the seller asks, so a seller nets price ÷ 1.15 —
 * which is why the stored fee is 0.1304 and not 0.15, and why this is one
 * multiplication rather than a per-market special case.
 */
export function netProceeds(price: number, market: Market["id"], settings: Settings): number {
  const fee = settings.marketFees[market] ?? 0;
  return round2(price * (1 - fee));
}

export interface MarketProceeds {
  market: Market["id"];
  label: string;
  /** What a buyer pays. */
  price: number;
  /** What reaches you. */
  net: number;
  /** Whether what reaches you can leave the platform as money. */
  cashOut: boolean;
  note: string;
}

/**
 * What each market would pay, best first — but never mixed together.
 *
 * Steam pays in wallet funds that cannot be withdrawn. Ranking it against cash
 * markets on net price alone would be a lie of the most useful-looking kind, so
 * the two are separated and stay separated.
 */
export function proceedsByMarket(quotes: PriceQuote[], settings: Settings): { cash: MarketProceeds[]; wallet: MarketProceeds[] } {
  const best = new Map<Market["id"], number>();
  for (const quote of quotes) {
    if (quote.source === "manual" || quote.price === null) continue;
    const id = quote.source;
    const held = best.get(id);
    if (held === undefined || quote.price > held) best.set(id, quote.price);
  }
  const rows: MarketProceeds[] = [...best.entries()].map(([market, price]) => ({
    market,
    label: MARKETS[market].label,
    price: round2(price),
    net: netProceeds(price, market, settings),
    cashOut: MARKETS[market].cashOut,
    note: MARKETS[market].note,
  }));
  const bestFirst = (a: MarketProceeds, b: MarketProceeds) => b.net - a.net;
  return {
    cash: rows.filter((r) => r.cashOut).sort(bestFirst),
    wallet: rows.filter((r) => !r.cashOut).sort(bestFirst),
  };
}

function manualQuote(item: Pick<ItemRecord, "manualPrice">, fetchedAt: string): PriceQuote | null {
  if (item.manualPrice === null) return null;
  return {
    source: "manual",
    sourceLabel: "Your own price",
    currency: "USD",
    url: null,
    matchedName: "",
    price: item.manualPrice,
    volume: null,
    fetchedAt,
  };
}

/**
 * Fold what every source said into the one view the app records and shows.
 *
 * The headline is the highest price any market is showing, because that is the
 * one an owner could realise; which market it was is recorded alongside, since
 * the number means nothing without it. A price typed in by hand beats all of
 * them: it is the owner saying they know better, and overriding that quietly
 * would be worse than useless.
 */
export function summarize(
  item: Pick<ItemRecord, "manualPrice" | "stattrak" | "souvenir">,
  quotes: PriceQuote[],
  errors: Array<{ source: string; message: string }>,
  fetchedAt = new Date().toISOString(),
): PriceSummary {
  const manual = manualQuote(item, fetchedAt);
  const all = manual ? [manual, ...quotes] : quotes;

  let market: number | null = null;
  let marketSource: string | null = null;
  for (const quote of quotes) {
    if (quote.price === null) continue;
    if (market === null || quote.price > market) {
      market = round2(quote.price);
      marketSource = quote.sourceLabel;
    }
  }

  let yourCopyValue: number | null = null;
  let yourCopyBasis: string;
  if (manual) {
    yourCopyValue = round2(manual.price!);
    yourCopyBasis = "Your own price";
  } else if (market !== null) {
    yourCopyValue = market;
    yourCopyBasis = `${marketSource} listing`;
  } else {
    // Nothing found is a real answer and says so. Estimating from a
    // neighbouring wear tier or from the plain variant of a StatTrak skin would
    // produce a number that looks measured and is not.
    yourCopyBasis = errors.length ? "No price: every source failed" : "No source is listing one right now";
  }

  return {
    currency: "USD",
    fetchedAt,
    market,
    marketSource,
    yourCopyValue,
    yourCopyBasis,
    quotes: all,
    errors,
  };
}

export function itemToQuery(item: Pick<ItemRecord, "marketHashName" | "externalIds">): ItemQuery {
  return { marketHashName: item.marketHashName, externalIds: item.externalIds };
}

/** Price one item: ask the sources, then fold the answers together. */
export async function priceItem(item: ItemRecord, fetchImpl?: typeof fetch): Promise<PriceSummary> {
  const { quotes, errors } = await fetchQuotes(itemToQuery(item), fetchImpl);
  return summarize(item, quotes, errors);
}
