import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Portfolio } from "@/components/Portfolio";
import type { PortfolioPoint, Realized, Returns } from "@/lib/analytics";
import { DEFAULT_SETTINGS } from "@/lib/types";

// The refresh button reads the router; nothing here clicks it.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const point = (days: number, over: Partial<PortfolioPoint> & { value: number }): PortfolioPoint => ({ t: ago(days), ungraded: over.value, priced: 3, copies: 5, cost: 0, costedValue: 0, flows: 0, ...over });
const returns: Returns = { invested: 0, valueOfInvested: 0, amount: 0, percent: null, cardsWithCost: 0, cardsAwaitingPrice: 0, copiesWithoutCost: 0 };
const realized: Realized = { proceeds: 0, fees: 0, cost: 0, gain: 0, percent: null, sales: 0, copies: 0, withoutCost: 0 };

/** The dashboard as the server sends it: the recorded history and nothing else of interest. */
const draw = (points: PortfolioPoint[], pricePoints: PortfolioPoint[] = []) =>
  renderToStaticMarkup(
    createElement(Portfolio, {
      points, pricePoints, historyStartedAt: ago(40), freshCount: 3, cardCount: 3, copyCount: 5, pricedCount: 3, lastRefreshed: null,
      opportunities: [], holdings: [], returns, allocation: [], settings: DEFAULT_SETTINGS, realized, recentSales: [],
    }),
  ).replace(/<!-- -->/g, "");

describe("the dashboard's change over the window", () => {
  it("says how much of a rise was cards added and how much was prices, and leaves the plain percentage off the headline", () => {
    // 1000 held at the start; 400 of cards came in; prices added 100 on what was held.
    const html = draw([point(10, { value: 1000, flows: 1000, cost: 800, costedValue: 1000 }), point(1, { value: 1500, flows: 1400, cost: 1100, costedValue: 1400 })]);
    expect(html).toContain("▲ $500.00");
    // 500 / 1000 would call the cards that came in a 50% gain.
    expect(html).not.toContain("50.00%");
    expect(html).toContain("$400.00 of that is cards added or newly priced");
    // 100 over 1000 held plus half of the 400 that came in.
    expect(html).toContain("▲ $100.00 (8.33%)");
    expect(html).toContain("from prices moving");
  });

  it("says how much of a fall was cards sold, and carries the market's fall with its arrow", () => {
    const html = draw([point(10, { value: 1500, flows: 1500 }), point(1, { value: 900, flows: 1000 })]);
    expect(html).toContain("▼ $600.00");
    expect(html).toContain("$500.00 left with cards sold");
    expect(html).toContain("▼ $100.00 (8.00%)");
  });

  it("gives the market's move its own direction when the cards that came in outweigh a fall in prices", () => {
    // Up 350 on the whole, but 400 of that was cards and prices lost 50.
    const html = draw([point(10, { value: 1000, flows: 1000 }), point(1, { value: 1350, flows: 1400 })]);
    expect(html).toContain("▲ $350.00");
    expect(html).toContain("$400.00 of that is cards added or newly priced");
    expect(html).toContain("▼ $50.00 (4.17%)"); // 50 / (1000 + 200)
  });

  it("is the plain change, with its percentage, when nothing was added or sold in the window", () => {
    const html = draw([point(10, { value: 1000, flows: 1000 }), point(1, { value: 1100, flows: 1000 })]);
    expect(html).toContain("▲ $100.00 (10.00%)");
    expect(html).not.toContain("from prices moving");
  });
});

describe("the key under the chart", () => {
  it("names the cost line, the opening rule and the copies held, with their figures", () => {
    const html = draw([point(10, { value: 1000, cost: 800, costedValue: 1000 }), point(1, { value: 1100, cost: 800, costedValue: 1100, copies: 6 })]);
    expect(html).toContain('aria-label="Chart key"');
    expect(html).toContain("Value $1,100.00");
    // The cost line is on, and the key's entry for it is the button that turns it off.
    expect(html).toContain('aria-pressed="true" title="Hide the cost-basis line"');
    expect(html).toContain("Cost basis $800.00");
    expect(html).toContain("Range start $1,000.00");
    expect(html).toContain("6 copies held");
    expect(html).toContain('data-series="basis"');
  });

  it("has no cost line to offer while nothing recorded has a cost", () => {
    const html = draw([point(10, { value: 1000 }), point(1, { value: 1100 })]);
    expect(html).not.toContain("Cost basis");
    expect(html).not.toContain('data-series="basis"');
    expect(html).toContain("Range start $1,000.00");
  });
});
