import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { addSnapshot, createCard, getCard } from "@/lib/cards";
import { addCard, createSubmission, deleteSubmission, getSubmission, listSubmissions, markSent, recordReturn, removeCard } from "@/lib/submissions";
import { submissionOutcome } from "@/lib/analytics";
import { type PriceSummary } from "@/lib/types";

const summary = (over: Partial<PriceSummary>): PriceSummary => ({
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
  ...over,
});

function pricedCard(name: string, raw: number, psa10: number) {
  const card = createCard({ game: "pokemon", name });
  addSnapshot(card.id, summary({ ungraded: raw, yourCopyValue: raw, graded: { "PSA 10": psa10, "PSA 9": raw * 2 } }));
  return card;
}

describe("grading submissions", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("captures raw and best-case values when a card is added", () => {
    const card = pricedCard("Charizard", 100, 900);
    const sub = addCard(createSubmission({ company: "PSA", feePerCard: 25, shipping: 20 }).id, card.id);
    expect(sub.cards[0]).toMatchObject({ cardId: card.id, rawValue: 100, expectedValue: 900, returnedGrade: null });
    expect(sub.name).toBe("PSA submission");
  });

  it("refuses cards that are already graded, and unknown cards", () => {
    const sub = createSubmission({ company: "PSA" });
    const graded = createCard({ game: "mtg", name: "Lotus", gradingCompany: "PSA", grade: "9" });
    expect(() => addCard(sub.id, graded.id)).toThrow(/already graded/);
    expect(() => addCard(sub.id, 999)).toThrow(/Card not found/);
    expect(() => createSubmission({ company: "  " })).toThrow(/grading company/);
    expect(() => createSubmission({ company: "PSA", feePerCard: -5 })).toThrow(/at least zero/);
  });

  it("moves cards to 'at the grader' when sent, and back when removed", () => {
    const card = pricedCard("Pikachu", 40, 150);
    const sub = addCard(createSubmission({ company: "CGC" }).id, card.id);
    expect(() => markSent(createSubmission({ company: "PSA" }).id)).toThrow(/at least one card/);
    markSent(sub.id);
    expect(getCard(card.id)?.gradingStatus).toBe("submitted");
    expect(getSubmission(sub.id)?.status).toBe("sent");
    removeCard(sub.id, card.id);
    expect(getCard(card.id)?.gradingStatus).toBe("planned");
  });

  it("applies returned grades to the cards and books the outcome", () => {
    const a = pricedCard("Charizard", 100, 900);
    const b = pricedCard("Blastoise", 50, 300);
    const sub0 = createSubmission({ company: "PSA", feePerCard: 25, shipping: 20 });
    addCard(sub0.id, a.id);
    addCard(sub0.id, b.id);
    markSent(sub0.id);
    const sub = recordReturn(sub0.id, [
      { cardId: a.id, grade: "10" },
      { cardId: b.id, grade: "9" },
    ]);
    expect(sub.status).toBe("returned");
    expect(getCard(a.id)).toMatchObject({ gradingCompany: "PSA", grade: "10", gradingStatus: "undecided" });
    expect(sub.cards.map((c) => c.returnedValue)).toEqual([900, 100]);
    const o = submissionOutcome(sub);
    // 1000 back, 150 raw in, 70 of fees
    expect(o).toMatchObject({ cards: 2, cost: 70, rawValue: 150, returnedValue: 1000, graded: 2, gain: 780 });
  });

  it("rejects grades for cards outside the batch", () => {
    const card = pricedCard("Pikachu", 40, 150);
    const sub = addCard(createSubmission({ company: "PSA" }).id, card.id);
    expect(() => recordReturn(sub.id, [{ cardId: 999, grade: "10" }])).toThrow(/not in this submission/);
    expect(() => recordReturn(sub.id, [{ cardId: card.id, grade: "10" }], "nonsense")).toThrow(/valid date/);
  });

  it("returns cards to planned when a sent submission is deleted", () => {
    const card = pricedCard("Pikachu", 40, 150);
    const sub = addCard(createSubmission({ company: "PSA" }).id, card.id);
    markSent(sub.id);
    expect(deleteSubmission(sub.id)).toBe(true);
    expect(getCard(card.id)?.gradingStatus).toBe("planned");
    expect(listSubmissions()).toHaveLength(0);
  });

  it("reports a best case while the batch is still out", () => {
    const o = submissionOutcome({
      feePerCard: 25,
      shipping: 10,
      status: "sent",
      cards: [
        { rawValue: 100, expectedValue: 900, returnedGrade: null, returnedValue: null },
        { rawValue: 50, expectedValue: null, returnedGrade: null, returnedValue: null },
      ],
    });
    expect(o).toMatchObject({ cost: 60, rawValue: 150, expectedValue: 950, graded: 0, gain: null });
  });
});
