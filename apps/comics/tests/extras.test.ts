import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { engine } from "@/lib/engine";
import { summarizeComics } from "@/lib/pricing/summary";
import type { Comic } from "@/lib/types";
import type { ItemInput, PriceQuote } from "@collectcollect/core/domain/spec";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => "/" }));

const { comicExtras } = await import("@/components/ComicExtras");

const settings = { ...engine.settings.defaults, ownerName: "", alertMovePercent: 15, alertWebhookUrl: "", exportPrivateFields: false };

const quote = (prices: Record<string, number>, at: string): PriceQuote => ({
  source: "pricecharting",
  sourceLabel: "PriceCharting",
  currency: "USD",
  url: null,
  matchedName: "Amazing Spider-Man #300",
  matchedDetail: "Marvel Comics",
  price: 250,
  prices,
  fetchedAt: at,
});

/** The page's context for a comic that has been priced at each of these times, as the item page loads it. */
function pageOf(over: Partial<ItemInput<Comic>>, priced: Array<[string, Record<string, number>]>) {
  const item = engine.repo.createItem({ title: "The Amazing Spider-Man", issueNumber: "300", publisher: "Marvel", ...over });
  for (const [at, prices] of priced) engine.repo.addSnapshot(item.id, summarizeComics({ item, quotes: [quote(prices, at)], errors: [], settings, fetchedAt: at }));
  const snapshots = engine.repo.listSnapshots(item.id);
  return comicExtras({ item, snapshots, latest: snapshots[0]?.summary ?? null, settings: engine.settings.getSettings(), acquisitions: [], sales: [] });
}

const html = (node: React.ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));
const grades = { "Grade 8.0": 600, "Grade 9.0": 900, "Grade 9.2": 1100, "Grade 9.4": 1400, "Grade 9.8": 4000 };

describe("the prices beside a comic's price panel", () => {
  it("lists the raw price, then the graded ones from the best grade down, then the first few estimates", () => {
    const page = pageOf({ grade: "9.4" }, [["2026-01-01T00:00:00.000Z", { "Grade 9.0": 900, "Grade 9.8": 4000, "Grade 8.0": 600, "Grade 9.4": 1400 }]]);
    expect(page.named).toEqual([
      { label: "Raw", value: 250 },
      { label: "Grade 9.8", value: 4000 },
      { label: "Grade 9.4", value: 1400 },
      { label: "Grade 9.0", value: 900 },
      { label: "Grade 8.0", value: 600 },
      { label: "Grade 9.9 (estimate)", value: 1500, estimated: true },
      { label: "Grade 9.6 (estimate)", value: 500, estimated: true },
      { label: "Grade 9.2 (estimate)", value: 350, estimated: true },
    ]);
    expect(pageOf({ grade: "9.4" }, []).named).toEqual([]);
  });
});

describe("a raw copy's grade-or-wait panel", () => {
  const widest: [string, Record<string, number>] = ["2026-03-01T00:00:00.000Z", grades];
  const rising: Array<[string, Record<string, number>]> = [["2026-01-01T00:00:00.000Z", { ...grades, "Grade 9.8": 2000 }], ["2026-02-01T00:00:00.000Z", { ...grades, "Grade 9.8": 3000 }], widest];

  it("says the copy clears the owner's thresholds, with the upside after the fee, when it does", () => {
    const panel = html(pageOf({ grade: "9.4" }, rising).afterPrice);
    expect(panel).toContain("Near the best recorded premium");
    expect(panel).toContain("Clears your thresholds: $3,690.00 of upside after the $60.00 fee.");
  });

  it("does not, while there is too little history to say", () => {
    expect(html(pageOf({ grade: "9.4" }, [widest]).afterPrice)).not.toContain("Clears your thresholds");
  });

  it("draws an empty panel before any price, and none for a slab", () => {
    expect(html(pageOf({ grade: "9.4" }, []).afterPrice)).toContain("No outlook yet");
    expect(pageOf({ slabbed: true, gradingCompany: "cgc", grade: "9.4", certNumber: "2036123-004" }, [widest]).afterPrice).toBeNull();
  });
});
