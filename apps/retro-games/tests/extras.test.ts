import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { engine } from "@/lib/engine";
import { summarizeGames } from "@/lib/pricing/summary";
import type { Game } from "@/lib/types";
import type { ItemInput, PriceQuote } from "@collectcollect/core/domain/spec";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/" }));

const { gameExtras } = await import("@/components/GameExtras");

const settings = { ...engine.settings.defaults, ownerName: "", alertMovePercent: 15, alertWebhookUrl: "", exportPrivateFields: false };

const quote = (prices: Record<string, number>, at: string): PriceQuote => ({
  source: "pricecharting",
  sourceLabel: "PriceCharting",
  currency: "USD",
  url: null,
  matchedName: "Super Mario 64",
  matchedDetail: "Nintendo 64",
  price: prices.Loose ?? null,
  prices,
  fetchedAt: at,
});

/** The page's context for a game that has been priced at each of these times, as the item page loads it. */
function pageOf(over: Partial<ItemInput<Game>>, priced: Array<[string, Record<string, number>]>) {
  const item = engine.repo.createItem({ title: "Super Mario 64", platform: "n64", region: "ntsc_u", ...over });
  for (const [at, prices] of priced) engine.repo.addSnapshot(item.id, summarizeGames({ item, quotes: [quote(prices, at)], errors: [], settings, fetchedAt: at }));
  const snapshots = engine.repo.listSnapshots(item.id);
  return gameExtras({ item, snapshots, latest: snapshots[0]?.summary ?? null, settings: engine.settings.getSettings(), acquisitions: [], sales: [] });
}

const html = (node: React.ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));
const sealed = { completeness: "sealed", boxCondition: "very_good" } as const;

describe("the prices beside a game's price panel", () => {
  it("lists the tiers that have a price, in their own order, and an estimate where the graded price is a guess", () => {
    const real = pageOf(sealed, [["2026-01-01T00:00:00.000Z", { Loose: 35, CIB: 120, New: 2500 }]]);
    expect(real.named).toEqual([
      { label: "Loose", value: 35 },
      { label: "CIB", value: 120 },
      { label: "New (sealed)", value: 2500 },
      { label: "Graded (estimate)", value: 5000, estimated: true },
    ]);
    const some = pageOf(sealed, [["2026-01-01T00:00:00.000Z", { New: 2500, Graded: 9000 }]]);
    expect(some.named).toEqual([
      { label: "New (sealed)", value: 2500 },
      { label: "Graded", value: 9000 },
    ]);
    expect(pageOf(sealed, []).named).toEqual([]);
  });
});

describe("a sealed copy's grade-or-wait panel", () => {
  const widest: [string, Record<string, number>] = ["2026-03-01T00:00:00.000Z", { New: 2500, Graded: 9000 }];
  const rising: Array<[string, Record<string, number>]> = [["2026-01-01T00:00:00.000Z", { New: 2500, Graded: 6000 }], ["2026-02-01T00:00:00.000Z", { New: 2500, Graded: 7000 }], widest];

  it("says the copy clears the owner's thresholds, with the upside after the fee, when it does", () => {
    const panel = html(pageOf(sealed, rising).afterPrice);
    expect(panel).toContain("Near the best recorded premium");
    expect(panel).toContain("Clears your thresholds: $6,400.00 of upside after the $100.00 fee.");
    expect(panel).not.toContain("estimate from the multiplier");
  });

  it("does not, while there is too little history to say, and says so when the graded figure is a guess", () => {
    const panel = html(pageOf(sealed, [widest]).afterPrice);
    expect(panel).not.toContain("Clears your thresholds");
    const guess = html(pageOf(sealed, [["2026-03-01T00:00:00.000Z", { New: 2500 }]]).afterPrice);
    expect(guess).toContain("The graded figure is an estimate from the multiplier in Settings");
  });

  it("draws an empty panel before any price, and none for a loose copy", () => {
    expect(html(pageOf(sealed, []).afterPrice)).toContain("No outlook yet");
    expect(pageOf({ completeness: "loose" }, [widest]).afterPrice).toBeNull();
  });
});
