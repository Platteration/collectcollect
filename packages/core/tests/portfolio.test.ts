import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const { Portfolio } = await import("../src/components/domain/Portfolio");

type Props = Parameters<typeof Portfolio>[0];

const props = (points: Props["points"]): Props => ({
  noun: { singular: "widget", plural: "widgets" },
  points,
  itemCount: 2,
  copyCount: 2,
  pricedCount: points.length ? 2 : 0,
  excludedCount: 0,
  lastRefreshed: null,
  holdings: [],
  returns: { invested: 0, valueOfInvested: 0, amount: 0, percent: null, itemsWithCost: 0, itemsAwaitingPrice: 0, copiesWithoutCost: 0 },
  allocations: [],
  realized: { proceeds: 0, fees: 0, cost: 0, gain: 0, percent: null, sales: 0, copies: 0, withoutCost: 0 },
  recentSales: [],
  emptyNote: "Nothing yet",
  hasSeed: false,
});

const headline = (points: Props["points"]) => /<p class="hero-figure[^"]*">([^<]*)<\/p>/.exec(renderToStaticMarkup(createElement(Portfolio, props(points))))?.[1];

describe("the portfolio's headline figure", () => {
  it("is the total at the latest point, and nothing before there is one", () => {
    expect(headline([])).toBe("$0.00");
    expect(headline([{ t: "2026-01-01T00:00:00.000Z", value: 10, priced: 1 }])).toBe("$10.00");
    expect(
      headline([
        { t: "2026-01-01T00:00:00.000Z", value: 10, priced: 1 },
        { t: "2026-02-01T00:00:00.000Z", value: 1234.5, priced: 2 },
      ]),
    ).toBe("$1,234.50");
  });
});
