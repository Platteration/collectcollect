import { describe, expect, it } from "vitest";
import { fetchQuotes, gradeKey, gradeLookupKeys, learnFromQuotes, summarize } from "@/lib/pricing";
import { DEFAULT_SETTINGS, type PriceQuote } from "@/lib/types";
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
  it("prices a legacy condition at face value rather than at NaN", () => {
    // `condition` is cast off a card row, so a row written before the
    // whitelists were tightened can hold anything. A bare index with `?? 1`
    // reads Object.prototype for a condition of "constructor" — a function,
    // which is not nullish, so the fallback never fires and the multiplication
    // produces NaN: a price that is simply wrong, with nothing to report it.
    for (const condition of ["constructor", "__proto__", "toString", "MINT"]) {
      const s = summarize([quote({ ungraded: 100 })], [], DEFAULT_SETTINGS, {
        condition: condition as never,
        gradingCompany: null,
        grade: null,
      });
      expect(s.yourCopyValue).toBe(100);
      expect(Number.isFinite(s.yourCopyValue)).toBe(true);
    }
    // A condition this app does write still gets its multiplier.
    const lp = summarize([quote({ ungraded: 100 })], [], DEFAULT_SETTINGS, { condition: "LP", gradingCompany: null, grade: null });
    expect(lp.yourCopyValue).toBe(100 * DEFAULT_SETTINGS.conditionMultipliers.LP);
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
