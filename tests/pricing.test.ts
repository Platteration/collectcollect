import { beforeEach, describe, expect, it } from "vitest";
import { fetchQuotes, gradeKey, gradeLookupKeys, learnFromQuotes, summarize } from "@/lib/pricing";
import { refreshAll, resetRefreshThrottle } from "@/lib/pricing/refresh";
import { addSnapshot, createCard, listSnapshots, updateCard } from "@/lib/cards";
import { openDatabase, setDb } from "@/lib/db";
import { DEFAULT_SETTINGS, type PriceQuote, type PriceSummary } from "@/lib/types";

const blank: PriceSummary = {
  currency: "USD",
  fetchedAt: new Date().toISOString(),
  ungraded: null,
  ungradedSource: null,
  graded: {},
  gradedSource: null,
  estimatedGraded: {},
  yourCopyValue: null,
  yourCopyBasis: "",
  quotes: [],
  errors: [],
};
import { fakeFetch } from "./helpers";

const quote = (over: Partial<PriceQuote>): PriceQuote => ({
  source: "pokemontcg",
  sourceLabel: "TCGplayer",
  currency: "USD",
  url: null,
  matchedName: "x",
  matchedDetail: null,
  ungraded: null,
  ungradedVariants: {},
  graded: {},
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("grade keys", () => {
  it("normalizes company + grade", () => {
    expect(gradeKey("psa", "10")).toBe("PSA 10");
    expect(gradeKey("BGS", "Grade 9.5")).toBe("BGS 9.5");
    expect(gradeKey(null, "9")).toBe("Grade 9");
    expect(gradeKey("PSA", "")).toBeNull();
  });
  it("lists fallbacks for lookups", () => {
    expect(gradeLookupKeys("CGC", "10")).toEqual(["CGC 10", "Grade 10", "PSA 10"]);
    expect(gradeLookupKeys("PSA", "9")).toEqual(["PSA 9", "Grade 9"]);
  });
});

describe("summarize", () => {
  it("values a raw copy from the highest-priority USD source, adjusted for condition", () => {
    const s = summarize(
      [quote({ source: "ygoprodeck", sourceLabel: "YGO", ungraded: 50 }), quote({ currency: "EUR", ungraded: 999 }), quote({ ungraded: 100 })],
      [],
      DEFAULT_SETTINGS,
      { condition: "LP", gradingCompany: null, grade: null },
    );
    expect(s.ungraded).toBe(100);
    expect(s.ungradedSource).toBe("TCGplayer");
    expect(s.yourCopyValue).toBe(85);
    expect(s.estimatedGraded["PSA 10"]).toBe(300);
    expect(s.gradedSource).toBeNull();
  });
  it("uses real graded prices and does not estimate those grades", () => {
    const s = summarize(
      [quote({ source: "pricecharting", sourceLabel: "PriceCharting", ungraded: 100, graded: { "PSA 10": 900, "Grade 9": 200 } })],
      [],
      DEFAULT_SETTINGS,
      { condition: "NM", gradingCompany: "PSA", grade: "9" },
    );
    expect(s.gradedSource).toBe("PriceCharting");
    expect(s.yourCopyValue).toBe(200);
    expect(s.yourCopyBasis).toContain("Grade 9");
    expect(s.estimatedGraded).not.toHaveProperty("PSA 10");
    expect(s.estimatedGraded["BGS 10"]).toBe(500);
  });
  it("falls back to an estimate for a graded copy with no graded source", () => {
    const s = summarize([quote({ ungraded: 100 })], [], DEFAULT_SETTINGS, { condition: "NM", gradingCompany: "PSA", grade: "10" });
    expect(s.yourCopyValue).toBe(300);
    expect(s.yourCopyBasis).toMatch(/Estimated/);
  });
  it("lets manual prices override providers", () => {
    const s = summarize(
      [quote({ source: "pricecharting", sourceLabel: "PriceCharting", ungraded: 100, graded: { "PSA 10": 900 } })],
      [],
      DEFAULT_SETTINGS,
      { condition: "NM", gradingCompany: "PSA", grade: "10" },
      { ungraded: 120, graded: { "PSA 10": 1000 } },
    );
    expect(s.ungraded).toBe(120);
    expect(s.ungradedSource).toBe("Manual entry");
    expect(s.graded["PSA 10"]).toBe(1000);
    expect(s.yourCopyValue).toBe(1000);
    expect(s.quotes[0].source).toBe("manual");
  });
  it("reports nothing gracefully", () => {
    const s = summarize([], [{ source: "pokemontcg", message: "down" }], DEFAULT_SETTINGS, { condition: "NM", gradingCompany: null, grade: null });
    expect(s.yourCopyValue).toBeNull();
    expect(s.errors).toHaveLength(1);
  });
});

describe("fetchQuotes", () => {
  it("collects provider failures as errors instead of throwing", async () => {
    const fetchImpl = fakeFetch([["api.pokemontcg.io", { error: "boom" }, 500]]);
    const { quotes, errors } = await fetchQuotes({ game: "pokemon", name: "Pikachu" }, fetchImpl);
    expect(quotes).toEqual([]);
    expect(errors[0]).toMatchObject({ source: "pokemontcg" });
    expect(errors[0].message).toMatch(/HTTP 500/);
  });
  it("only runs providers for the card's game", async () => {
    const fetchImpl = fakeFetch([["ygoprodeck", { data: [{ id: 1, name: "Kuriboh", card_prices: [{ tcgplayer_price: "0.50" }] }] }]]);
    const { quotes } = await fetchQuotes({ game: "yugioh", name: "Kuriboh" }, fetchImpl);
    expect(quotes.map((q) => q.source)).toEqual(["ygoprodeck"]);
  });
});

describe("learnFromQuotes", () => {
  it("collects external ids and the first reference image", () => {
    const learned = learnFromQuotes([
      quote({ source: "manual", externalId: "ignored" }),
      quote({ source: "pokemontcg", externalId: "base1-4", referenceImageUrl: "https://img/1" }),
      quote({ source: "pricecharting", externalId: "99", referenceImageUrl: "https://img/2" }),
    ]);
    expect(learned).toEqual({ externalIds: { pokemontcg: "base1-4", pricecharting: "99" }, referenceImageUrl: "https://img/1" });
  });
});

describe("refreshCard", () => {
  it("does not overwrite a card's last known price when every source fails", async () => {
    const { openDatabase, setDb } = await import("@/lib/db");
    const { createCard, addSnapshot, listSnapshots } = await import("@/lib/cards");
    const { refreshCard } = await import("@/lib/pricing/refresh");
    setDb(openDatabase(":memory:"));
    const card = createCard({ game: "pokemon", name: "Pikachu" });
    addSnapshot(card.id, summarizeFixture(50));
    const original = globalThis.fetch;
    globalThis.fetch = fakeFetch([["api.pokemontcg.io", { error: "down" }, 503]]);
    try {
      const r = await refreshCard(card);
      expect(r.stored).toBe(false);
      expect(r.snapshot.summary.errors).toHaveLength(1);
      expect(listSnapshots(card.id)).toHaveLength(1);
      expect(listSnapshots(card.id)[0].summary.ungraded).toBe(50);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("refreshCard without a configured source", () => {
  it("keeps the last snapshot for a game with no price provider", async () => {
    const { openDatabase, setDb } = await import("@/lib/db");
    const { createCard, addSnapshot, listSnapshots } = await import("@/lib/cards");
    const { refreshCard } = await import("@/lib/pricing/refresh");
    setDb(openDatabase(":memory:"));
    const card = createCard({ game: "sports", name: "Mike Trout" });
    addSnapshot(card.id, summarizeFixture(800));
    const r = await refreshCard(card);
    expect(r.stored).toBe(false);
    expect(r.snapshot.summary.errors).toEqual([]);
    expect(listSnapshots(card.id)).toHaveLength(1);
  });
  it("stores the first snapshot even when it has no price", async () => {
    const { openDatabase, setDb } = await import("@/lib/db");
    const { createCard, listSnapshots } = await import("@/lib/cards");
    const { refreshCard } = await import("@/lib/pricing/refresh");
    setDb(openDatabase(":memory:"));
    const card = createCard({ game: "sports", name: "Mike Trout" });
    expect((await refreshCard(card)).stored).toBe(true);
    expect(listSnapshots(card.id)).toHaveLength(1);
  });
});

function summarizeFixture(v: number) {
  return summarize([quote({ ungraded: v })], [], DEFAULT_SETTINGS, { condition: "NM", gradingCompany: null, grade: null });
}

describe("grade labels", () => {
  it("reads a trailing zero as the same grade", () => {
    expect(gradeKey("PSA", "10.0")).toBe("PSA 10");
    expect(gradeKey("BGS", "9.50")).toBe("BGS 9.5");
    expect(gradeKey("psa", "10")).toBe("PSA 10");
    expect(gradeKey("Other", "9")).toBe("Grade 9");
    expect(gradeKey(null, " ")).toBeNull();
    // and so a "10.0" copy still finds the price sources publish as "PSA 10"
    expect(gradeLookupKeys("CGC", "10.0")).toEqual(["CGC 10", "Grade 10", "PSA 10"]);
  });
});

describe("refreshing a whole collection", () => {
  beforeEach(() => {
    setDb(openDatabase(":memory:"));
    resetRefreshThrottle();
  });

  it("prices only the cards that have gone stale", async () => {
    // "other" has no configured source here, so a manual price is the only
    // price, and nothing in this test reaches the network.
    const fresh = createCard({ game: "other", name: "Freshly priced", manualUngraded: 10 });
    const stale = createCard({ game: "other", name: "Long forgotten", manualUngraded: 20 });
    addSnapshot(fresh.id, { ...blank, fetchedAt: new Date().toISOString(), ungraded: 10, yourCopyValue: 10 });
    addSnapshot(stale.id, { ...blank, fetchedAt: new Date(Date.now() - 72 * 3600e3).toISOString(), ungraded: 20, yourCopyValue: 20 });

    const result = await refreshAll({ staleHours: 24 });
    expect(result).toMatchObject({ refreshed: 1, skipped: 1, unpriced: 0 });
    expect(result.failed).toEqual([]);
    expect(listSnapshots(stale.id)).toHaveLength(2);
    expect(listSnapshots(fresh.id)).toHaveLength(1);

    // Everything is fresh now, so a second pass has nothing to do.
    expect(await refreshAll({ staleHours: 24 })).toMatchObject({ refreshed: 0, skipped: 2 });
    // With no cutoff, everything is priced again.
    expect(await refreshAll()).toMatchObject({ refreshed: 2, skipped: 0 });
  });

  it("records the first look even when nothing has a price for the card", async () => {
    const card = createCard({ game: "other", name: "Nothing knows this card" });
    expect(await refreshAll({ staleHours: 24 })).toMatchObject({ refreshed: 1, unpriced: 0 });
    // A card with no history at all gets its "we looked, and found nothing"
    // snapshot, which is what the card page explains.
    expect(listSnapshots(card.id)).toHaveLength(1);
    expect(listSnapshots(card.id)[0].summary.yourCopyValue).toBeNull();
  });

  it("waits out the window before trying a card that came back empty", async () => {
    const card = createCard({ game: "other", name: "Was priced once", manualUngraded: 30 });
    addSnapshot(card.id, { ...blank, fetchedAt: new Date(Date.now() - 72 * 3600e3).toISOString(), ungraded: 30, yourCopyValue: 30 });
    // The manual price goes away, so the next look finds nothing.
    updateCard(card.id, { manualUngraded: null });

    const first = await refreshAll({ staleHours: 24 });
    expect(first).toMatchObject({ refreshed: 0, unpriced: 1, skipped: 0 });
    // The card keeps its last known value rather than being zeroed out.
    expect(listSnapshots(card.id)).toHaveLength(1);
    expect(listSnapshots(card.id)[0].summary.yourCopyValue).toBe(30);
    // Its stored snapshot is still stale, but it was just tried, so it waits.
    expect(await refreshAll({ staleHours: 24 })).toMatchObject({ refreshed: 0, unpriced: 0, skipped: 1 });
  });
});

