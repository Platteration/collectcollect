import { describe, expect, it } from "vitest";
import { fetchQuotes } from "../src/domain/pricing/index";
import { ProviderError, type PriceProvider, type PriceQuote } from "../src/domain/spec";

type Query = { name: string };

const quoted = (source: string, price: number): PriceQuote => ({
  source,
  sourceLabel: `Source ${source}`,
  currency: "USD",
  url: null,
  matchedName: "x",
  matchedDetail: null,
  price,
  prices: {},
  fetchedAt: "2026-01-01T00:00:00.000Z",
});

function source(id: string, lookup: () => Promise<PriceQuote[]>, configured = true): PriceProvider<Query> {
  return { id, label: `Source ${id}`, optional: true, note: "test", isConfigured: () => configured, lookup };
}

describe("asking every source", () => {
  it("collects what each configured source says, in provider order, and leaves the others alone", async () => {
    let asked = false;
    const { quotes, errors } = await fetchQuotes(
      [
        source("a", async () => [quoted("a", 1), quoted("a", 2)]),
        source("off", async () => {
          asked = true;
          return [quoted("off", 99)];
        }, false),
        source("b", async () => [quoted("b", 3)]),
      ],
      { name: "x" },
    );
    expect(quotes.map((q) => [q.source, q.price])).toEqual([["a", 1], ["a", 2], ["b", 3]]);
    expect(errors).toEqual([]);
    expect(asked).toBe(false);
  });

  it("names each failure after the source it came from, whatever was thrown, and keeps what the others said", async () => {
    const { quotes, errors } = await fetchQuotes(
      [
        source("plain", async () => {
          throw new Error("plain failure");
        }),
        source("fine", async () => [quoted("fine", 5)]),
        source("own", async () => {
          throw new ProviderError("elsewhere", "named itself");
        }),
        source("odd", async () => {
          throw "not an error object";
        }),
      ],
      { name: "x" },
    );
    expect(quotes.map((q) => q.source)).toEqual(["fine"]);
    expect(errors).toEqual([
      { source: "plain", message: "plain failure" },
      { source: "elsewhere", message: "named itself" },
      { source: "odd", message: "not an error object" },
    ]);
  });

  it("gives up on a source that does not answer in time, and says which", async () => {
    const { quotes, errors } = await fetchQuotes(
      [source("slow", () => new Promise<PriceQuote[]>(() => undefined)), source("quick", async () => [quoted("quick", 7)])],
      { name: "x" },
      fetch,
      20,
    );
    expect(quotes.map((q) => q.source)).toEqual(["quick"]);
    expect(errors).toEqual([{ source: "slow", message: "Source slow timed out" }]);
  });

  it("answers with nothing when no source is configured", async () => {
    expect(await fetchQuotes([source("off", async () => [quoted("off", 1)], false)], { name: "x" })).toEqual({ quotes: [], errors: [] });
    expect(await fetchQuotes([], { name: "x" })).toEqual({ quotes: [], errors: [] });
  });
});
