import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { addSnapshot, createCard, getCard } from "@/lib/cards";
import { addCard, createSubmission, deleteSubmission, getSubmission, listSubmissions, markSent, recordReturn, removeCard, updateSubmission } from "@/lib/submissions";
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

  it("stays open until every card has a grade", () => {
    const a = pricedCard("Charizard", 100, 900);
    const b = pricedCard("Blastoise", 50, 300);
    const sub0 = createSubmission({ company: "PSA", feePerCard: 25 });
    addCard(sub0.id, a.id);
    addCard(sub0.id, b.id);
    markSent(sub0.id);
    const partial = recordReturn(sub0.id, [{ cardId: a.id, grade: "10" }]);
    expect(partial.status).toBe("sent");
    expect(partial.returnedAt).toBeNull();
    // the second card can still be graded afterwards
    const done = recordReturn(sub0.id, [{ cardId: b.id, grade: "9" }]);
    expect(done.status).toBe("returned");
    expect(done.returnedAt).not.toBeNull();
    expect(getCard(b.id)?.grade).toBe("9");
  });

  it("writes nothing when any result in a batch is refused", () => {
    const a = pricedCard("Charizard", 100, 900);
    const b = pricedCard("Blastoise", 80, 500);
    const sub0 = createSubmission({ company: "PSA" });
    addCard(sub0.id, a.id);
    addCard(sub0.id, b.id);
    markSent(sub0.id);
    // The second result names a card that is not in the batch. Recording the
    // first before refusing the second would leave one card valued as graded
    // while the batch still says it is at the grader.
    expect(() => recordReturn(sub0.id, [{ cardId: a.id, grade: "10" }, { cardId: 999, grade: "9" }])).toThrow(/not in this submission/);
    expect(getCard(a.id)!.grade).toBeNull();
    expect(getSubmission(sub0.id)!.cards.every((c) => c.returnedGrade === null)).toBe(true);
    expect(getSubmission(sub0.id)!.status).toBe("sent");
  });

  it("says what is wrong with results that are not a list of cards and grades", () => {
    const card = pricedCard("Charizard", 100, 900);
    const sub = addCard(createSubmission({ company: "PSA" }).id, card.id);
    for (const bad of [{ cardId: card.id }, "10", null, 42, [null], [{ grade: "10" }], [{ cardId: "1", grade: "10" }], [{ cardId: card.id, grade: {} }]]) {
      expect(() => recordReturn(sub.id, bad), JSON.stringify(bad)).toThrow(/result|card|grade/i);
    }
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

describe("what a batch's outcome means before it is all back", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("judges a partial return on the cards that came back, not the whole batch", () => {
    const a = pricedCard("Charizard", 100, 900);
    const b = pricedCard("Blastoise", 50, 300);
    const sub0 = createSubmission({ company: "PSA", feePerCard: 25, shipping: 20 });
    addCard(sub0.id, a.id);
    addCard(sub0.id, b.id);
    markSent(sub0.id);
    const partial = recordReturn(sub0.id, [{ cardId: a.id, grade: "10" }]);
    const o = submissionOutcome(partial);
    // One card back: 900 for it, against its own 100 raw, one 25 fee and half
    // the 20 shipping. Charging it for Blastoise's fee too would make a batch
    // look like a loss purely because the rest of it is still at the grader.
    expect(o).toMatchObject({ graded: 1, returnedValue: 900, gain: 765 });

    const done = recordReturn(sub0.id, [{ cardId: b.id, grade: "9" }]);
    const full = submissionOutcome(done);
    expect(full).toMatchObject({ graded: 2, cost: 70, gain: 780 });
  });

  it("will not send a batch that has already come back", () => {
    const card = pricedCard("Mewtwo", 60, 400);
    const sub0 = createSubmission({ company: "PSA" });
    addCard(sub0.id, card.id);
    markSent(sub0.id);
    recordReturn(sub0.id, [{ cardId: card.id, grade: "10" }]);
    expect(() => markSent(sub0.id)).toThrow(/already come back/);
    expect(getCard(card.id)?.gradingStatus).toBe("undecided");
  });
});

describe("editing a batch and moving cards between batches", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("changes only the fields it was given", () => {
    const sub = createSubmission({ company: "PSA", name: "Spring batch", serviceLevel: "Value", feePerCard: 25, shipping: 20, notes: "In the post" });
    const renamed = updateSubmission(sub.id, { company: "PSA", name: "Summer batch" });
    expect(renamed).toMatchObject({ name: "Summer batch", company: "PSA", serviceLevel: "Value", feePerCard: 25, shipping: 20, notes: "In the post" });
    const repriced = updateSubmission(sub.id, { company: "CGC", feePerCard: 18, notes: null });
    expect(repriced).toMatchObject({ company: "CGC", feePerCard: 18, notes: null, name: "Summer batch" });
    expect(() => updateSubmission(999, { company: "PSA" })).toThrow(/not found/);
    expect(() => updateSubmission(sub.id, { company: "PSA", shipping: -1 })).toThrow(/at least zero/);
  });

  it("does not call a card back when the deleted batch was not the one it is away with", () => {
    const card = pricedCard("Blastoise", 80, 500);
    const away = addCard(createSubmission({ company: "PSA" }).id, card.id);
    markSent(away.id);
    const draft = addCard(createSubmission({ company: "CGC" }).id, card.id);
    expect(deleteSubmission(draft.id)).toBe(true);
    expect(getCard(card.id)?.gradingStatus).toBe("submitted");
    // Deleting the batch it really is away with does bring it back.
    expect(deleteSubmission(away.id)).toBe(true);
    expect(getCard(card.id)?.gradingStatus).toBe("planned");
  });

  it("does not call a card back from a batch it is still away with", () => {
    const card = pricedCard("Charizard", 100, 900);
    const away = addCard(createSubmission({ company: "PSA" }).id, card.id);
    markSent(away.id);
    expect(getCard(card.id)?.gradingStatus).toBe("submitted");

    // The same card was also listed on a draft that never went anywhere.
    const draft = addCard(createSubmission({ company: "CGC" }).id, card.id);
    removeCard(draft.id, card.id);
    expect(getCard(card.id)?.gradingStatus).toBe("submitted");
  });
});

describe("what a returned grade is booked at, and what a failed batch leaves", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("values a returned grade by the same chain of keys the card's own value uses", () => {
    const card = createCard({ game: "pokemon", name: "Charizard" });
    addSnapshot(card.id, summary({ ungraded: 100, yourCopyValue: 100, graded: { "PSA 10": 500 } }));
    const sub = addCard(createSubmission({ company: "CGC" }).id, card.id);
    markSent(sub.id);
    // There is no "CGC 10" price; the card page falls through to "Grade 10" and then "PSA 10", and so does the batch.
    expect(recordReturn(sub.id, [{ cardId: card.id, grade: "10" }]).cards[0]?.returnedValue).toBe(500);
  });

  it("marks nothing sent when any card in the batch cannot be", () => {
    const a = pricedCard("Charizard", 100, 900);
    const b = pricedCard("Blastoise", 50, 300);
    const sub = createSubmission({ company: "PSA" });
    addCard(sub.id, a.id);
    addCard(sub.id, b.id);
    getDb().exec(`CREATE TRIGGER fail BEFORE UPDATE ON cards WHEN NEW.id = ${b.id} AND NEW.grading_status = 'submitted' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    expect(() => markSent(sub.id)).toThrow(/boom/);
    expect(getSubmission(sub.id)?.status).toBe("draft");
    expect(getCard(a.id)?.gradingStatus).toBe("undecided");
    getDb().exec("DROP TRIGGER fail");
    markSent(sub.id);
    getDb().exec(`CREATE TRIGGER fail BEFORE UPDATE ON cards WHEN NEW.id = ${b.id} AND NEW.grading_status = 'planned' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    expect(() => deleteSubmission(sub.id)).toThrow(/boom/);
    expect(getSubmission(sub.id)?.status).toBe("sent");
    expect(getCard(a.id)?.gradingStatus).toBe("submitted");
  });
});

describe("the cert that comes back with a grade", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("writes the cert and a report that links the company's page, none for a company with no public report, and refuses a cert that is not text", () => {
    const a = pricedCard("Charizard", 100, 900);
    const b = pricedCard("Blastoise", 50, 300);
    const sub = createSubmission({ company: "PSA" });
    addCard(sub.id, a.id);
    addCard(sub.id, b.id);
    markSent(sub.id);
    expect(() => recordReturn(sub.id, [{ cardId: a.id, grade: "10", certNumber: { no: true } }])).toThrow(/cert number for card .* has to be text/);
    recordReturn(sub.id, [
      { cardId: a.id, grade: "10", certNumber: " 12345678 " },
      { cardId: b.id, grade: "9" },
    ]);
    expect(getCard(a.id)).toMatchObject({ certNumber: "12345678", gradingReport: { company: "PSA", cert: "12345678", grade: "10", source: "manual", url: "https://www.psacard.com/cert/12345678/psa" } });
    expect(getCard(b.id)).toMatchObject({ grade: "9", certNumber: null, gradingReport: null });

    const c = pricedCard("Venusaur", 40, 200);
    const other = createSubmission({ company: "Other" });
    addCard(other.id, c.id);
    markSent(other.id);
    recordReturn(other.id, [{ cardId: c.id, grade: "9", certNumber: "X1" }]);
    expect(getCard(c.id)).toMatchObject({ gradingCompany: "Other", certNumber: "X1", gradingReport: null });
  });
});

describe("a stored submission status the app never writes", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("reads back as a draft, not as something inherited from Object.prototype", () => {
    const submission = createSubmission({ name: "Batch", company: "PSA" });
    for (const name of ["constructor", "toString", "__proto__"]) {
      getDb().prepare("UPDATE submissions SET status = ? WHERE id = ?").run(name, submission.id);
      expect(getSubmission(submission.id)?.status).toBe("draft");
    }
  });
});
