import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initializeDatabase, openDatabase, setDb } from "@/lib/db";
import { HasSalesError, addAcquisition, addSnapshot, allSnapshots, collectionTotals, countCards, createCard, deleteCard, findSimilar, getCard, latestSnapshotsByCard, latestValuesByCard, listCards, listSnapshots, markChecked, recentSnapshotsByCard, recomputeAllLatest, snapshotValues, updateCard } from "@/lib/cards";
import { listLots, verifyLotInvariant } from "@/lib/acquisitions";
import { deleteSale, recordSale } from "@/lib/sales";
import { createAlert } from "@/lib/alerts";
import { getSettings, saveSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS, type GradingReportInput, type PriceQuote, type PriceSummary } from "@/lib/types";
import { listAlerts } from "@/lib/alerts";
import { summarize } from "@/lib/pricing";
import { latestSnapshot } from "@/lib/cards";

/** A TAG report as the owner would type it off the DIG page. */
const tagReport = (over: Partial<GradingReportInput> = {}): GradingReportInput => ({
  company: "TAG",
  cert: "A1234567",
  source: "manual",
  checkedAt: "2026-10-01T00:00:00.000Z",
  grade: "10",
  label: "Pristine",
  tag: { score: 973, rollups: { centering: 990, corners: 960, edges: 970, surface: 980 } },
  ...over,
});

const summary = (v: number): PriceSummary => ({
  currency: "USD",
  fetchedAt: new Date(2026, 0, v).toISOString(),
  ungraded: v,
  ungradedSource: "t",
  graded: {},
  gradedSource: null,
  estimatedGraded: {},
  yourCopyValue: v,
  yourCopyBasis: "",
  quotes: [],
  errors: [],
});

describe("card repository", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("creates, reads, updates and deletes cards", () => {
    const card = createCard({ game: "pokemon", name: " Charizard ", cardNumber: "4/102", quantity: "2" as unknown as number, year: "1999" as unknown as number });
    expect(card).toMatchObject({ name: "Charizard", quantity: 2, year: 1999, condition: "NM", externalIds: {} });
    const updated = updateCard(card.id, { gradingCompany: "PSA", grade: "9", externalIds: { pokemontcg: "base1-4" }, manualGraded: { "PSA 9": 300 } });
    expect(updated).toMatchObject({ grade: "9", externalIds: { pokemontcg: "base1-4" }, manualGraded: { "PSA 9": 300 }, name: "Charizard" });
    expect(getCard(card.id)?.grade).toBe("9");
    expect(deleteCard(card.id)).toBe(true);
    expect(getCard(card.id)).toBeNull();
  });

  it("rejects bad input", () => {
    expect(() => createCard({ game: "chess" as never, name: "x" })).toThrow(/Unknown game/);
    expect(() => createCard({ game: "mtg", name: "  " })).toThrow(/name/);
    expect(() => createCard({ game: "mtg", name: "x", condition: "MINT" as never })).toThrow(/condition/);
  });

  it("filters and searches", () => {
    createCard({ game: "pokemon", name: "Pikachu", setName: "Jungle" });
    createCard({ game: "yugioh", name: "Dark Magician" });
    createCard({ game: "sports", name: "Mike Trout", sport: "baseball" });
    expect(listCards({ game: "yugioh" }).map((c) => c.name)).toEqual(["Dark Magician"]);
    expect(listCards({ search: "jungle" }).map((c) => c.name)).toEqual(["Pikachu"]);
    expect(listCards({ search: "baseball" }).map((c) => c.name)).toEqual(["Mike Trout"]);
    expect(listCards()).toHaveLength(3);
  });

  it("keeps price snapshots per card and reports the latest for each", () => {
    const a = createCard({ game: "mtg", name: "A" });
    const b = createCard({ game: "mtg", name: "B" });
    addSnapshot(a.id, summary(1));
    addSnapshot(a.id, summary(2));
    addSnapshot(b.id, summary(5));
    expect(listSnapshots(a.id).map((s) => s.summary.ungraded)).toEqual([2, 1]);
    const latest = latestSnapshotsByCard();
    expect(latest.get(a.id)?.summary.ungraded).toBe(2);
    expect(latest.get(b.id)?.summary.ungraded).toBe(5);
    deleteCard(a.id);
    expect(listSnapshots(a.id)).toEqual([]);
  });
});

describe("storage locations", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("records where a card is kept and lists the places in use", async () => {
    const { listLocations } = await import("@/lib/cards");
    createCard({ game: "pokemon", name: "A", location: "  Binder 2, page 4  " });
    createCard({ game: "pokemon", name: "B", location: "Binder 2, page 4" });
    createCard({ game: "mtg", name: "C", location: "Box A" });
    createCard({ game: "mtg", name: "D" });
    // A sold-out card is not somewhere you can go and find it.
    createCard({ game: "mtg", name: "E", location: "Box A", quantity: 0 });

    expect(getCard(1)?.location).toBe("Binder 2, page 4");
    expect(listLocations()).toEqual([
      { location: "Binder 2, page 4", cards: 2 },
      { location: "Box A", cards: 1 },
    ]);
  });

  it("filters by location, including cards with none recorded", () => {
    createCard({ game: "pokemon", name: "Filed", location: "Box A" });
    createCard({ game: "pokemon", name: "Loose" });
    expect(listCards({ location: "Box A" }).map((c) => c.name)).toEqual(["Filed"]);
    expect(listCards({ location: "" }).map((c) => c.name)).toEqual(["Loose"]);
    expect(listCards()).toHaveLength(2);
    // Location is searchable, so "where did I put the Box A cards" works too.
    expect(listCards({ search: "Box A" }).map((c) => c.name)).toEqual(["Filed"]);
  });
});

describe("findSimilar", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));
  it("matches on game + name with number or set agreement", () => {
    createCard({ game: "pokemon", name: "Pikachu", setName: "Jungle", cardNumber: "60/64" });
    createCard({ game: "pokemon", name: "Pikachu", setName: "Base Set", cardNumber: "58/102" });
    createCard({ game: "yugioh", name: "Pikachu" });
    expect(findSimilar({ game: "pokemon", name: "pikachu", cardNumber: "60" }).map((c) => c.setName)).toEqual(["Jungle"]);
    expect(findSimilar({ game: "pokemon", name: "Pikachu", setName: "jungle" }).map((c) => c.setName)).toEqual(["Jungle"]);
    expect(findSimilar({ game: "pokemon", name: "Pikachu" })).toHaveLength(2);
    expect(findSimilar({ game: "mtg", name: "Pikachu" })).toHaveLength(0);
  });
  it("migrates older databases by adding grading_status", () => {
    const db = openDatabase(":memory:");
    db.exec("ALTER TABLE cards DROP COLUMN grading_status");
    setDb(openDatabase(":memory:"));
    const card = createCard({ game: "mtg", name: "x", gradingStatus: "planned" });
    expect(card.gradingStatus).toBe("planned");
    expect(() => createCard({ game: "mtg", name: "x", gradingStatus: "lost" as never })).toThrow(/grading status/);
  });

  it("migrates older databases by adding centering and grading_report", () => {
    const db = openDatabase(":memory:");
    db.exec("ALTER TABLE cards DROP COLUMN centering");
    db.exec("ALTER TABLE cards DROP COLUMN grading_report");
    initializeDatabase(db);
    setDb(db);
    const card = createCard({ game: "mtg", name: "x", centering: { front: { lr: "55/45" } }, gradingReport: tagReport() });
    expect(getCard(card.id)).toMatchObject({ centering: { front: { lr: [55, 45], tb: null }, back: { lr: null, tb: null } }, gradingReport: { company: "TAG", cert: "A1234567" } });
  });

  it("stores centering and a grading report, and refuses a bad shape with a reason", () => {
    expect(() => createCard({ game: "mtg", name: "x", centering: { front: { lr: "60/45" } } })).toThrow(/add up to 100/);
    expect(() => createCard({ game: "mtg", name: "x", gradingReport: tagReport({ tag: { score: 5000 } }) })).toThrow(/grading report/);
    // A whole side typed into one box, and the back as the report prints it.
    const card = createCard({ game: "mtg", name: "x", centering: { front: { lr: "54L/46R 49T/51B" }, back: "45L/55R" }, gradingReport: tagReport() });
    expect(card.centering).toEqual({ front: { lr: [54, 46], tb: [49, 51] }, back: { lr: [45, 55], tb: null } });
    expect(card.gradingReport).toMatchObject({ company: "TAG", source: "manual", grade: "10", tag: { score: 973 }, population: null });
    // Blank boxes are no measurement; an edit that leaves them blank clears it.
    expect(updateCard(card.id, { centering: { front: { lr: "", tb: "" }, back: { lr: "", tb: "" } }, gradingReport: null })).toMatchObject({ centering: null, gradingReport: null });
    // An edit that says nothing about either leaves both alone.
    const again = updateCard(card.id, { centering: { front: { lr: "55/45" } }, gradingReport: tagReport() })!;
    expect(updateCard(card.id, { location: "Box A" })).toMatchObject({ centering: again.centering, gradingReport: again.gradingReport });
  });
});

describe("settings", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("returns defaults and merges saved values", () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings({ gradeMultipliers: { "PSA 10": 4, " bad": -1 as number, "": 2 }, conditionMultipliers: { ...DEFAULT_SETTINGS.conditionMultipliers, LP: 0.9 }, gradingFee: 30, readyMinUpside: 10, readyMinUpsidePercent: 20, ownerName: "  Ada  ", alertMovePercent: 5, alertWebhookUrl: "javascript:alert(1)" });
    const s = getSettings();
    expect(s.gradeMultipliers).toEqual({ "PSA 10": 4 });
    expect(s.conditionMultipliers.LP).toBe(0.9);
    expect(s.conditionMultipliers.NM).toBe(1);
    expect(s.gradingFee).toBe(30);
    expect(s.readyMinUpside).toBe(10);
    expect(s.ownerName).toBe("Ada");
    expect(s.alertMovePercent).toBe(5);
    expect(s.alertWebhookUrl).toBe(""); // only http(s) is stored
  });
});

describe("intakeCard", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("creates the first copy and merges the second", async () => {
    const { intakeCard } = await import("@/lib/cards");
    const first = intakeCard({ game: "pokemon", name: "Charizard", setName: "Base Set", cardNumber: "4/102" });
    expect(first.result).toBe("created");
    const second = intakeCard({ game: "pokemon", name: "Charizard", setName: "Base Set", cardNumber: "4/102" });
    expect(second).toMatchObject({ result: "merged" });
    if (second.result !== "created" && second.result !== "merged") throw new Error("unexpected");
    expect(second.card.quantity).toBe(2);
    expect(listCards()).toHaveLength(1);
  });

  it("never folds a raw scan into a graded copy, or the reverse", async () => {
    const { intakeCard } = await import("@/lib/cards");
    intakeCard({ game: "pokemon", name: "Charizard", cardNumber: "4/102", gradingCompany: "PSA", grade: "9" });
    const raw = intakeCard({ game: "pokemon", name: "Charizard", cardNumber: "4/102" });
    expect(raw.result).toBe("ambiguous");
    if (raw.result !== "ambiguous") throw new Error("unexpected");
    expect(raw.candidates).toHaveLength(1);
    // a second slab at the same grade is interchangeable, so it merges
    const slab = intakeCard({ game: "pokemon", name: "Charizard", cardNumber: "4/102", gradingCompany: "PSA", grade: "9" });
    expect(slab).toMatchObject({ result: "merged" });
  });

  it("stops rather than guessing when several owned cards match", async () => {
    const { intakeCard } = await import("@/lib/cards");
    createCard({ game: "pokemon", name: "Pikachu" });
    createCard({ game: "pokemon", name: "Pikachu" });
    expect(intakeCard({ game: "pokemon", name: "Pikachu" }).result).toBe("ambiguous");
  });

  it("adopts the photo when the existing row has none", async () => {
    const { intakeCard } = await import("@/lib/cards");
    createCard({ game: "mtg", name: "Ragavan" });
    const merged = intakeCard({ game: "mtg", name: "Ragavan", imagePath: "11111111-2222-4333-8444-555555555555.jpg", accentColor: "#abcdef" });
    if (merged.result !== "merged") throw new Error("expected a merge");
    expect(merged.card).toMatchObject({ imagePath: "11111111-2222-4333-8444-555555555555.jpg", accentColor: "#abcdef", quantity: 2 });
  });
});

describe("what the repository refuses and what it matches", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("does not accept a key it inherited from Object as a game or a condition", () => {
    expect(() => createCard({ game: "constructor" as never, name: "Nice try" })).toThrow(/Unknown game/);
    expect(() => createCard({ game: "pokemon", name: "Nice try", condition: "toString" as never })).toThrow(/Unknown condition/);
    expect(() => createCard({ game: "pokemon", name: "Nice try", gradingStatus: "hasOwnProperty" as never })).toThrow(/Unknown grading status/);
  });

  it("searches for the characters typed, not for LIKE wildcards", () => {
    createCard({ game: "pokemon", name: "Bulbasaur", notes: "50% off" });
    createCard({ game: "pokemon", name: "Charmander" });
    expect(listCards({ search: "50%" }).map((c) => c.name)).toEqual(["Bulbasaur"]);
    // A bare "%" is a wildcard in LIKE; here it must find only the card that
    // really has one, not the whole collection.
    expect(listCards({ search: "%" }).map((c) => c.name)).toEqual(["Bulbasaur"]);
    expect(listCards({ search: "_" })).toHaveLength(0);
  });

  it("applies every filter it is given at once", () => {
    createCard({ game: "pokemon", name: "Gengar", location: "Box A" });
    createCard({ game: "pokemon", name: "Gengar", location: "Box B" });
    createCard({ game: "yugioh", name: "Gengar-ish", location: "Box A" });
    expect(listCards({ game: "pokemon", search: "Gengar", location: "Box A" })).toHaveLength(1);
  });

  it("treats a differently numbered set as a different set", () => {
    createCard({ game: "pokemon", name: "Charizard", setName: "Base Set" });
    // "Base" is how someone writes "Base Set" in a hurry.
    expect(findSimilar({ game: "pokemon", name: "Charizard", setName: "Base" })).toHaveLength(1);
    // "Base Set 2" is a different set, and merging into it would lose a card.
    expect(findSimilar({ game: "pokemon", name: "Charizard", setName: "Base Set 2" })).toHaveLength(0);
  });

  it("takes a card's prices and alerts with it when it goes", () => {
    const card = createCard({ game: "pokemon", name: "Doomed", quantity: 2 });
    addSnapshot(card.id, summary(5));
    createAlert({ kind: "price_move", cardId: card.id, title: "Moved", body: "up" });
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM price_snapshots").get()).toEqual({ n: 1 });
    deleteCard(card.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM price_snapshots").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM alerts").get()).toEqual({ n: 0 });
  });

  it("will not delete a card that has sales, until they are undone", () => {
    // The sales table cascades from the card, and a sale is money that changed
    // hands. Deleting the card would erase it from the report and the tax year.
    const card = createCard({ game: "pokemon", name: "Sold once", quantity: 2 });
    const sale = recordSale(card.id, { quantity: 1, unitPrice: 10 });
    expect(() => deleteCard(card.id)).toThrow(HasSalesError);
    expect(() => deleteCard(card.id)).toThrow(/1 recorded sale\. Undo it first/);
    expect(getCard(card.id)).not.toBeNull();
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM sales").get()).toEqual({ n: 1 });
    deleteSale(sale.id);
    expect(deleteCard(card.id)).toBe(true);
    expect(getCard(card.id)).toBeNull();
  });

  it("refuses a negative price and an absurd quantity", () => {
    expect(() => createCard({ game: "pokemon", name: "x", purchasePrice: -5 })).toThrow(/cannot be negative/);
    expect(() => createCard({ game: "pokemon", name: "x", manualUngraded: -1 })).toThrow(/cannot be negative/);
    expect(() => createCard({ game: "pokemon", name: "x", manualGraded: { "PSA 10": -1 } })).toThrow(/cannot be negative/);
    expect(() => createCard({ game: "pokemon", name: "x", purchasePrice: 1e12 })).toThrow(/larger than anything/);
    expect(() => createCard({ game: "pokemon", name: "x", quantity: 5_000_000 })).toThrow(/larger than anything/);
    const card = createCard({ game: "pokemon", name: "x", quantity: 1 });
    // The same rule for a later purchase: a negative cost used to be filed
    // silently as "unknown", which read as a gift.
    expect(() => addAcquisition(card.id, { quantity: 1, unitCost: -2 })).toThrow(/cannot be negative/);
    expect(getCard(card.id)!.quantity).toBe(1);
    expect(verifyLotInvariant()).toEqual([]);
  });

  it("leaves quantity and lots agreeing when an update fails half way", () => {
    const card = createCard({ game: "pokemon", name: "Half", quantity: 2, purchasePrice: 3 });
    // The row would be updated first and the lots second. Make the second step
    // fail and check the first is undone with it.
    getDb().exec(
      "CREATE TRIGGER no_adjustments BEFORE INSERT ON acquisitions WHEN NEW.source = 'adjustment' BEGIN SELECT RAISE(ABORT, 'no adjustments today'); END",
    );
    expect(() => updateCard(card.id, { quantity: 10, notes: "changed" })).toThrow(/no adjustments/);
    expect(getCard(card.id)).toMatchObject({ quantity: 2, notes: null });
    expect(verifyLotInvariant()).toEqual([]);
  });
});

describe("the order a collection comes back in", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("is stable for cards saved in the same instant", () => {
    // Timestamps only go down to the millisecond, so cards saved in one tick —
    // a scan or an import — share one. Rather than race the clock, put them on
    // the same stamp deliberately and check the order is still decided.
    const made = Array.from({ length: 6 }, (_, i) => createCard({ game: "pokemon", name: `Same tick ${i}` }));
    getDb().prepare("UPDATE cards SET updated_at = ?").run("2026-01-01T00:00:00.000Z");
    const newestFirst = made.map((c) => c.id).reverse();
    for (let run = 0; run < 3; run++) {
      expect(listCards().map((c) => c.id)).toEqual(newestFirst);
    }
  });
});

describe("what an edit does to the match a source made", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));
  const matched = () => {
    const c = createCard({ game: "pokemon", name: "Charizard", cardNumber: "4/102", setName: "Base Set" });
    return updateCard(c.id, { externalIds: { pokemontcg: "base1-4" }, referenceImageUrl: "https://img.example/base1-4.png" })!;
  };

  it("forgets the ids and the reference image when the card's identity changes", () => {
    const c = matched();
    const edited = updateCard(c.id, { cardNumber: "5/102" })!;
    expect(edited.externalIds).toEqual({});
    expect(edited.referenceImageUrl).toBeNull();
    const again = updateCard(matched().id, { language: "Japanese" })!;
    expect(again.externalIds).toEqual({});
  });

  it("keeps them for an edit that does not change what the card is", () => {
    const c = matched();
    expect(updateCard(c.id, { notes: "binder 2" })?.externalIds).toEqual({ pokemontcg: "base1-4" });
    expect(updateCard(c.id, { grade: "9", gradingCompany: "PSA" })?.externalIds).toEqual({ pokemontcg: "base1-4" });
    expect(updateCard(c.id, { name: "charizard ", setName: "base set" })?.referenceImageUrl).toBe("https://img.example/base1-4.png");
  });

  it("keeps what the edit set itself", () => {
    const c = matched();
    expect(updateCard(c.id, { cardNumber: "5/102", externalIds: { pricecharting: "77" } })?.externalIds).toEqual({ pricecharting: "77" });
  });
});

describe("which copies may share a row", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));
  const base = { game: "pokemon" as const, name: "Charizard", setName: "Base Set", cardNumber: "4/102" };

  it("keeps a different variant, language or condition apart, and a blank apart from a value", async () => {
    const { intakeCard } = await import("@/lib/cards");
    createCard({ ...base, variant: "holo", language: "English" });
    expect(intakeCard({ ...base, variant: null, language: "English" }).result).toBe("ambiguous");
    expect(intakeCard({ ...base, variant: "holo", language: "Japanese" }).result).toBe("ambiguous");
    expect(intakeCard({ ...base, variant: "holo", language: "English", condition: "DMG" }).result).toBe("ambiguous");
    expect(listCards()).toHaveLength(1);
  });

  it("does not let case or spacing divide copies", async () => {
    const { intakeCard } = await import("@/lib/cards");
    createCard({ ...base, variant: "Holo", language: "English" });
    const merged = intakeCard({ ...base, variant: " holo ", language: "english" });
    expect(merged).toMatchObject({ result: "merged" });
    if (merged.result === "merged") expect(merged.card.quantity).toBe(2);
  });

  it("keeps two slabs with different certs apart, and a blank cert apart from a value", async () => {
    const { intakeCard } = await import("@/lib/cards");
    createCard({ ...base, gradingCompany: "PSA", grade: "9", certNumber: "11111111" });
    expect(intakeCard({ ...base, gradingCompany: "PSA", grade: "9", certNumber: "22222222" }).result).toBe("ambiguous");
    expect(intakeCard({ ...base, gradingCompany: "PSA", grade: "9" }).result).toBe("ambiguous");
    expect(listCards()).toHaveLength(1);
    // The same cert, however it is spaced, is the same slab.
    expect(intakeCard({ ...base, gradingCompany: "PSA", grade: "9", certNumber: " 11111111 " })).toMatchObject({ result: "merged" });
  });
});

describe("what an edit does to the value", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));
  const quote = (over: Partial<PriceQuote>): PriceQuote => ({
    source: "pokemontcg", sourceLabel: "TCGplayer", currency: "USD", url: null, matchedName: "Charizard", matchedDetail: null,
    ungraded: null, ungradedVariants: {}, graded: {}, fetchedAt: "2026-03-01T00:00:00.000Z", ...over,
  });
  const priced = () => {
    const c = createCard({ game: "pokemon", name: "Charizard" });
    const quotes = [quote({ ungraded: 100 }), quote({ source: "pricecharting", sourceLabel: "PriceCharting", graded: { "PSA 9": 300 } })];
    addSnapshot(c.id, summarize(quotes, [], DEFAULT_SETTINGS, { condition: "NM", gradingCompany: null, grade: null }, undefined, "2026-03-01T00:00:00.000Z"));
    return c;
  };

  it("values a newly graded copy at its grade at once, from the quotes it already has, without a new row or an alert", () => {
    const c = priced();
    expect(latestSnapshot(c.id)?.summary.yourCopyValue).toBe(100);
    updateCard(c.id, { gradingCompany: "PSA", grade: "9" });
    const latest = latestSnapshot(c.id)!;
    expect(latest.summary.yourCopyValue).toBe(300);
    expect(latest.summary.yourCopyBasis).toMatch(/PSA 9/);
    expect(latest.fetchedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(latest.summary.recomputedAt).toBeDefined();
    expect(listSnapshots(c.id)).toHaveLength(1);
    expect(listAlerts()).toHaveLength(0);
  });

  it("values a worn copy by its condition, and a manual price over everything, once", () => {
    const c = priced();
    updateCard(c.id, { condition: "LP" });
    expect(latestSnapshot(c.id)?.summary.yourCopyValue).toBe(Math.round(100 * DEFAULT_SETTINGS.conditionMultipliers.LP * 100) / 100);
    updateCard(c.id, { manualUngraded: 50 });
    const latest = latestSnapshot(c.id)!;
    expect(latest.summary.ungraded).toBe(50);
    expect(latest.summary.quotes.filter((q) => q.source === "manual")).toHaveLength(1);
    updateCard(c.id, { manualUngraded: 60 });
    expect(latestSnapshot(c.id)?.summary.ungraded).toBe(60);
    expect(latestSnapshot(c.id)?.summary.quotes.filter((q) => q.source === "manual")).toHaveLength(1);
  });

  it("raises a price-move alert at once when the owner's own price jumps past the threshold, and not for a grade", () => {
    const c = priced();
    updateCard(c.id, { manualUngraded: 400 });
    const alerts = listAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "price_move", cardId: c.id });
    expect(alerts[0]?.title).toMatch(/up 300\.0%/);
    expect(alerts[0]?.body).toMatch(/when you changed its price/);
    updateCard(c.id, { manualUngraded: 401 }); // a quarter of a percent is not a move
    updateCard(c.id, { gradingCompany: "PSA", grade: "9" }); // a reclassification is not a move either
    expect(listAlerts()).toHaveLength(1);
  });

  it("re-derives a stored snapshot's averaged prices from its quotes, in place, when the settings are saved", () => {
    const card = createCard({ game: "pokemon", name: "Charizard", gradingCompany: "PSA", grade: "10" });
    const quote = (source: PriceQuote["source"], sourceLabel: string, graded: Record<string, number>): PriceQuote => ({
      source, sourceLabel, currency: "USD", url: null, matchedName: "x", matchedDetail: null, ungraded: 100, ungradedVariants: {}, graded, fetchedAt: new Date(2026, 0, 1).toISOString(),
    });
    const quotes = [quote("pricecharting", "PriceCharting", { "PSA 10": 900 }), quote("pokemontcg", "TCGplayer", { "PSA 10": 1000 })];
    // A snapshot stored before the sources were kept: first source wins, nothing behind it.
    const before = summarize(quotes, [], DEFAULT_SETTINGS, { condition: "NM", gradingCompany: "PSA", grade: "10" });
    const { gradedSources: _dropped, ...older } = before;
    void _dropped;
    addSnapshot(card.id, { ...older, graded: { "PSA 10": 900 }, yourCopyValue: 900, yourCopyBasis: "PSA 10 price from PriceCharting + TCGplayer." });
    expect(recomputeAllLatest(getSettings())).toBe(1);
    const latest = latestSnapshot(card.id)!;
    expect(latest.summary.graded["PSA 10"]).toBe(950);
    expect(latest.summary.yourCopyValue).toBe(950);
    expect(latest.summary.gradedSources?.["PSA 10"]).toHaveLength(2);
    expect(latest.summary.recomputedAt).toBeTruthy();
    expect(listSnapshots(card.id)).toHaveLength(1);
  });

  it("leaves the snapshot alone when the edit changes nothing about the value", () => {
    const c = priced();
    updateCard(c.id, { notes: "x", location: "Binder 1" });
    expect(latestSnapshot(c.id)?.summary.recomputedAt).toBeUndefined();
  });
});

describe("what the database indexes", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("finds a card by game and name without reading the whole collection", () => {
    const names = (table: string) => (getDb().prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((i) => i.name);
    expect(names("cards")).toEqual(expect.arrayContaining(["idx_cards_game_name", "idx_cards_updated", "idx_cards_location"]));
    expect(names("sale_lots")).toContain("idx_sale_lots_acquisition");
    expect(names("submission_cards")).toContain("idx_submission_cards_card");
    expect(names("alerts")).toContain("idx_alerts_card");
    const plan = (getDb()
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM cards WHERE game = ? AND lower(trim(name)) = ? ORDER BY updated_at DESC, id DESC")
      .all("pokemon", "charizard") as Array<{ detail: string }>)
      .map((r) => r.detail)
      .join("; ");
    expect(plan).toMatch(/idx_cards_game_name/);
    expect(plan).not.toMatch(/SCAN cards/);
  });
});

describe("what the dashboard reads of the price history", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("reads the two figures the portfolio sums straight out of every row, in the same order", () => {
    const a = createCard({ game: "pokemon", name: "A" });
    const b = createCard({ game: "pokemon", name: "B" });
    addSnapshot(a.id, summary(3));
    addSnapshot(b.id, { ...summary(2), yourCopyValue: null, ungraded: null });
    const marked = addSnapshot(a.id, { ...summary(5), ungraded: 4.25 });
    markChecked(marked.id, "2026-02-01T00:00:00.000Z");
    const values = snapshotValues();
    expect(values).toEqual(
      allSnapshots().map((s) => ({
        id: s.id,
        cardId: s.cardId,
        fetchedAt: s.fetchedAt,
        ...(s.checkedAt ? { checkedAt: s.checkedAt } : {}),
        summary: { yourCopyValue: s.summary.yourCopyValue ?? null, ungraded: s.summary.ungraded ?? null },
      })),
    );
    expect(values.map((v) => v.summary.yourCopyValue)).toEqual([null, 3, 5]);
    expect(values.at(-1)).toMatchObject({ checkedAt: "2026-02-01T00:00:00.000Z", summary: { ungraded: 4.25 } });
  });

  it("hands the outlook each card's newest snapshots only, oldest first", () => {
    const a = createCard({ game: "pokemon", name: "A" });
    const b = createCard({ game: "pokemon", name: "B" });
    for (const v of [1, 2, 3]) addSnapshot(a.id, summary(v));
    addSnapshot(b.id, summary(7));
    const recent = recentSnapshotsByCard(2);
    expect(recent.get(a.id)?.map((s) => s.summary.yourCopyValue)).toEqual([2, 3]);
    expect(recent.get(b.id)?.map((s) => s.summary.yourCopyValue)).toEqual([7]);
    expect(recent.get(a.id)?.[1]).toEqual(listSnapshots(a.id)[0]);
  });
});

describe("sorting and paging the collection", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  function seed() {
    const charizard = createCard({ game: "pokemon", name: "Charizard", quantity: 2, purchasePrice: 50 });
    const abra = createCard({ game: "pokemon", name: "abra" });
    const bulbasaur = createCard({ game: "pokemon", name: "Bulbasaur", quantity: 3 });
    const sold = createCard({ game: "yugioh", name: "Sold out", quantity: 0 });
    addSnapshot(charizard.id, summary(100));
    // The fixture dates a snapshot by its value; this one is the newest.
    addSnapshot(charizard.id, { ...summary(90), fetchedAt: new Date(2026, 5, 1).toISOString(), ungraded: 80 });
    addSnapshot(bulbasaur.id, summary(5));
    addSnapshot(sold.id, summary(1));
    return { charizard, abra, bulbasaur, sold };
  }

  it("orders by name, by value with unpriced cards last, and by when a card was added", () => {
    const { charizard, abra, bulbasaur, sold } = seed();
    getDb().prepare("UPDATE cards SET created_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", abra.id);
    expect(listCards({ sort: "name" }).map((c) => c.name)).toEqual(["abra", "Bulbasaur", "Charizard", "Sold out"]);
    expect(listCards({ sort: "value" }).map((c) => c.name)).toEqual(["Charizard", "Bulbasaur", "Sold out", "abra"]);
    expect(latestValuesByCard([charizard.id]).get(charizard.id)?.yourCopyValue).toBe(90);
    expect(listCards({ sort: "added" }).map((c) => c.id)).toEqual([sold.id, bulbasaur.id, charizard.id, abra.id]);
    // The default is untouched: last touched first.
    expect(listCards().map((c) => c.id)).toEqual(listCards({ sort: "updated" }).map((c) => c.id));
  });

  it("hands back one page at a time, and says how many there are in all", () => {
    seed();
    expect(listCards({ sort: "name", limit: 2 }).map((c) => c.name)).toEqual(["abra", "Bulbasaur"]);
    expect(listCards({ sort: "name", limit: 2, offset: 2 }).map((c) => c.name)).toEqual(["Charizard", "Sold out"]);
    expect(listCards({ sort: "name", limit: 2, offset: 4 })).toEqual([]);
    expect(countCards()).toBe(4);
    expect(countCards({ game: "yugioh" })).toBe(1);
    expect(countCards({ search: "saur" })).toBe(1);
  });

  it("totals the whole filtered collection, whatever page is shown", () => {
    const { charizard, bulbasaur } = seed();
    // The same numbers the page used to add up card by card.
    expect(collectionTotals()).toEqual({ cards: 4, owned: 3, copies: 6, value: 90 * 2 + 5 * 3, ungraded: 80 * 2 + 5 * 3, priced: 2 });
    expect(collectionTotals({ game: "yugioh" })).toEqual({ cards: 1, owned: 0, copies: 0, value: 0, ungraded: 0, priced: 0 });
    expect(collectionTotals({ search: "zard" })).toMatchObject({ cards: 1, value: 180, priced: 1 });
    expect(latestValuesByCard([charizard.id, bulbasaur.id, 999])).toEqual(
      new Map([
        [charizard.id, { yourCopyValue: 90, ungraded: 80 }],
        [bulbasaur.id, { yourCopyValue: 5, ungraded: 5 }],
      ]),
    );
    expect(latestValuesByCard([])).toEqual(new Map());
  });

  it("finds the cards whose copies have no recorded cost, in the database rather than after the fact", () => {
    const { charizard, abra } = seed();
    addAcquisition(abra.id, { quantity: 1, unitCost: null, acquiredAt: "2026-01-02" });
    expect(listCards({ missingCost: true }).map((c) => c.name).sort()).toEqual(["Bulbasaur", "abra"]);
    expect(countCards({ missingCost: true })).toBe(2);
    expect(listCards({ missingCost: true, game: "pokemon", search: "abra" }).map((c) => c.id)).toEqual([abra.id]);
    expect(countCards({ missingCost: true, search: "zard" })).toBe(0);
    expect(charizard.purchasePrice).toBe(50);
  });
});

describe("what a card may store from a client", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("stores only the identification fields it knows, whatever the client sent", () => {
    const card = createCard({
      game: "pokemon",
      name: "Charizard",
      identification: {
        name: "Charizard",
        confidence: 0.9,
        grading: { company: "PSA", grade: "9", cert_number: null },
        condition_assessment: null,
        // Anything a caller cares to add is dropped rather than persisted.
        payload: "x".repeat(1000),
      } as never,
    });
    expect(card.identification).toMatchObject({ name: "Charizard", confidence: 0.9 });
    expect(card.identification as unknown as Record<string, unknown>).not.toHaveProperty("payload");

    // A blob that is not an identification at all is not stored either.
    expect(createCard({ game: "pokemon", name: "Pikachu", identification: "🙂" as never }).identification).toBeNull();
    expect(createCard({ game: "pokemon", name: "Squirtle", identification: { confidence: "high" } as never }).identification).toBeNull();

    // Editing a card keeps the identification it already had.
    expect(updateCard(card.id, { notes: "edited" })?.identification).toMatchObject({ name: "Charizard" });
  });
});

describe("finding a card already owned by its name", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("folds a name the way the caller folds it, accents and all", () => {
    // The lookup compared SQLite's lower(trim(name)) with a key folded in
    // JavaScript: SQLite's lower() is ASCII-only and its trim() strips spaces
    // only, so "ÉLECTRODE" was stored as "Électrode" and searched for as
    // "électrode". The miss made a duplicate card rather than an error, so
    // nothing ever reported it. One function now writes and reads the key.
    createCard({ game: "pokemon", name: "ÉLECTRODE" });
    createCard({ game: "mtg", name: "\tRagavan " });
    expect(findSimilar({ game: "pokemon", name: "électrode" })).toHaveLength(1);
    expect(findSimilar({ game: "pokemon", name: " Électrode " })).toHaveLength(1);
    expect(findSimilar({ game: "mtg", name: "Ragavan" })).toHaveLength(1);
    // A composed and a decomposed accent are the same name to anyone typing it.
    expect(findSimilar({ game: "pokemon", name: "électrode" })).toHaveLength(1);
    // And a different name is still a different card.
    expect(findSimilar({ game: "pokemon", name: "electrode" })).toHaveLength(0);
  });

  it("keys a row written before the key existed, and one renamed since", () => {
    const card = createCard({ game: "pokemon", name: "Électrode" });
    // As an older database, or a restored one, holds it.
    getDb().prepare("UPDATE cards SET name_key = NULL WHERE id = ?").run(card.id);
    initializeDatabase(getDb());
    expect(findSimilar({ game: "pokemon", name: "ÉLECTRODE" }).map((c) => c.id)).toEqual([card.id]);
    updateCard(card.id, { name: "Kingdra" });
    expect(findSimilar({ game: "pokemon", name: "électrode" })).toHaveLength(0);
    expect(findSimilar({ game: "pokemon", name: "KINGDRA" }).map((c) => c.id)).toEqual([card.id]);
  });
});

/**
 * A price snapshot's summary is JSON parsed on the way out of the database by
 * the portfolio, the collection, the report, every card page and the cards API.
 * A restore installs a whole database, so one row of `{` used to take all of
 * them out together.
 */
describe("a snapshot whose summary is not readable", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  // The holdings history's own triggers read every new summary as JSON, so a
  // row like this is one they never saw: written into a live database before
  // they existed, by a build without them. (A restore refuses one.)
  const poison = (cardId: number, day: number) => {
    getDb().exec("DROP TRIGGER IF EXISTS history_snapshot_insert");
    getDb()
      .prepare("INSERT INTO price_snapshots (card_id, fetched_at, summary) VALUES (?, ?, ?)")
      .run(cardId, new Date(2026, 0, day).toISOString(), "{");
    initializeDatabase(getDb());
  };

  it("is dropped rather than thrown out of every page at once", () => {
    const card = createCard({ game: "pokemon", name: "Charizard" });
    poison(card.id, 1);
    addSnapshot(card.id, summary(5));

    // The good reading survives; the unreadable one simply is not there.
    expect(listSnapshots(card.id)).toHaveLength(1);
    expect(listSnapshots(card.id)[0]!.summary.ungraded).toBe(5);
    expect(allSnapshots()).toHaveLength(1);
    expect(latestSnapshotsByCard().get(card.id)?.summary.ungraded).toBe(5);
    expect(recentSnapshotsByCard(10).get(card.id)).toHaveLength(1);
    expect(snapshotValues().map((s) => s.summary.ungraded)).toEqual([5]);
  });

  it("costs that card its price and nothing more, even as the newest row", () => {
    const card = createCard({ game: "pokemon", name: "Charizard" });
    const other = createCard({ game: "mtg", name: "Ragavan" });
    addSnapshot(card.id, summary(5));
    addSnapshot(other.id, summary(7));
    poison(card.id, 9);

    const latest = latestSnapshotsByCard();
    expect(latest.has(card.id)).toBe(false);
    expect(latest.get(other.id)?.summary.ungraded).toBe(7);
  });
});

/**
 * Every name on Object.prototype is truthy on a plain table, and a row can hold
 * anything the write path would refuse: it predates a check, or a restore or
 * another tool put it there. These fields become table lookups, an image
 * source, a link and a style value on every page that lists the card.
 */
describe("a stored row the write path would have refused", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("reads back as values the app knows rather than as whatever is there", () => {
    const card = createCard({ game: "pokemon", name: "Charizard" });
    for (const name of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
      getDb().prepare("UPDATE cards SET game = ?, condition = ?, grading_status = ? WHERE id = ?").run(name, name, name, card.id);
      const read = getCard(card.id)!;
      expect(read.game).toBe("other");
      expect(read.condition).toBe("NM");
      expect(read.gradingStatus).toBe("undecided");
    }
    getDb()
      .prepare("UPDATE cards SET image_path = ?, reference_image_url = ?, accent_color = ? WHERE id = ?")
      .run("../../session-secret", "javascript:alert(1)", "red; background: url(https://tracker.example/x)", card.id);
    const read = getCard(card.id)!;
    expect(read.imagePath).toBeNull();
    expect(read.referenceImageUrl).toBeNull();
    expect(read.accentColor).toBeNull();
  });
});

describe("sports cards", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  const trout = { game: "sports", sport: "baseball", name: "Mike Trout", setName: "Topps Chrome", cardNumber: "US175", year: 2011 } as const;
  const SPORTS_COLUMNS = ["team", "rookie", "parallel", "serial_number", "autograph", "relic", "subgrades"];

  it("keeps the team, the flags, the parallel, the numbering and BGS subgrades", () => {
    const card = createCard({ ...trout, team: "Los Angeles Angels", rookie: "yes" as never, parallel: "Gold Refractor", serialNumber: "12 of 50", autograph: true, relic: 0 as never, gradingCompany: "BGS", grade: "9.5", subgrades: { centering: "9.5", corners: 9, edges: "10", surface: null } as never });
    expect(card).toMatchObject({ team: "Los Angeles Angels", rookie: true, parallel: "Gold Refractor", serialNumber: "12/50", autograph: true, relic: false, subgrades: { centering: 9.5, corners: 9, edges: 10, surface: null } });
    expect(getCard(card.id)).toMatchObject({ rookie: true, autograph: true, relic: false, subgrades: { centering: 9.5 } });
    const plain = createCard({ ...trout });
    expect(plain).toMatchObject({ team: null, rookie: false, parallel: null, serialNumber: null, autograph: false, relic: false, subgrades: null });
    // Subgrades outside the scale, or an empty set, are no subgrades.
    expect(createCard({ ...trout, subgrades: { centering: 11, corners: null, edges: null, surface: null } }).subgrades).toBeNull();
    // A flag is not a number: Number(true) is 1, which is a grade.
    expect(createCard({ ...trout, subgrades: { centering: true, corners: [9], edges: "", surface: 0 } as never }).subgrades).toBeNull();
  });

  it("writes every column a card had before the sports fields beside them", () => {
    // createCard once lost name_key, centering and grading_report when sports columns
    // were added next to them: the key is what finds a duplicate, the other two are
    // measurements nobody can type back in.
    const card = createCard({
      ...trout,
      team: "Los Angeles Angels",
      serialNumber: "12/50",
      centering: { front: { lr: "55/45", tb: "52/48" } },
      gradingReport: tagReport(),
      gradingCompany: "TAG",
      grade: "10",
      subgrades: { centering: 10, corners: 10, edges: 10, surface: 10 },
    });
    expect(card.centering).toEqual({ front: { lr: [55, 45], tb: [52, 48] }, back: { lr: null, tb: null } });
    expect(card.gradingReport).toMatchObject({ company: "TAG", cert: "A1234567" });
    expect(card.subgrades).toEqual({ centering: 10, corners: 10, edges: 10, surface: 10 });
    expect(getDb().prepare("SELECT name_key FROM cards WHERE id = ?").get(card.id)).toEqual({ name_key: "mike trout" });
    // Found by the key straight away, not after the next restart's backfill.
    expect(findSimilar({ game: "sports", name: "MIKE TROUT" }).map((c) => c.id)).toEqual([card.id]);
  });

  it("keeps the sports fields through an edit that does not mention them, and changes them when it does", () => {
    const card = createCard({ ...trout, team: "Angels", rookie: true, parallel: "Gold Refractor", serialNumber: "12/50", relic: true, subgrades: { centering: 9, corners: 9, edges: 9, surface: 9 }, centering: { front: { lr: "55/45" } } });
    const moved = updateCard(card.id, { location: "Box A" })!;
    expect(moved).toMatchObject({ team: "Angels", rookie: true, parallel: "Gold Refractor", serialNumber: "12/50", relic: true, subgrades: { centering: 9 }, centering: card.centering });
    const edited = updateCard(card.id, { team: "Los Angeles Angels", rookie: false, parallel: null, serialNumber: "13 / 50", relic: false, subgrades: { centering: 9.5, corners: null, edges: null, surface: null } })!;
    expect(edited).toMatchObject({ team: "Los Angeles Angels", rookie: false, parallel: null, serialNumber: "13/50", relic: false, subgrades: { centering: 9.5, corners: null } });
    expect(updateCard(card.id, { subgrades: null })?.subgrades).toBeNull();
    // The measured centering was never touched by any of it.
    expect(getCard(card.id)?.centering).toEqual(card.centering);
  });

  it("asks the sources afresh when the parallel, the autograph or the relic changes, and not for the rest", () => {
    // The guides list a Refractor, an autographed card and a relic card each as a product of its own.
    const matched = () => {
      const c = createCard({ ...trout, parallel: "Refractor", team: "Angels" });
      return updateCard(c.id, { externalIds: { pricecharting: "77" }, referenceImageUrl: "https://img.example/77.png" })!;
    };
    for (const change of [{ parallel: "Gold Refractor" }, { autograph: true }, { relic: true }]) {
      const edited = updateCard(matched().id, change)!;
      expect(edited.externalIds, JSON.stringify(change)).toEqual({});
      expect(edited.referenceImageUrl, JSON.stringify(change)).toBeNull();
    }
    for (const change of [{ team: "Padres" }, { rookie: true }, { serialNumber: "12/99" }, { subgrades: { centering: 9, corners: null, edges: null, surface: null } }, { parallel: " refractor " }]) {
      expect(updateCard(matched().id, change)?.externalIds, JSON.stringify(change)).toEqual({ pricecharting: "77" });
    }
  });

  it("never merges a serial-numbered card, and never merges into one", async () => {
    const { intakeCard } = await import("@/lib/cards");
    const first = intakeCard({ ...trout, parallel: "Gold Refractor", serialNumber: "12/50" });
    const second = intakeCard({ ...trout, parallel: "Gold Refractor", serialNumber: "12/50" });
    expect(first.result).toBe("created");
    expect(second.result).toBe("created");
    // A copy of the same parallel without numbering is not a copy of a numbered one either.
    expect(intakeCard({ ...trout, parallel: "Gold Refractor" }).result).toBe("created");
    expect(listCards()).toHaveLength(3);
  });

  it("does not let a numbered card make a base copy ambiguous, or take its place", async () => {
    const { intakeCard } = await import("@/lib/cards");
    // The numbered card is held first and is the only card that looks like the incoming copy.
    intakeCard({ ...trout, serialNumber: "7/25" });
    const base = intakeCard({ ...trout });
    expect(base.result).toBe("created");
    // Now there is one base row and one numbered row: a base copy stacks on the base row alone.
    const again = intakeCard({ ...trout });
    expect(again).toMatchObject({ result: "merged" });
    if (again.result !== "merged") throw new Error("expected a merge");
    expect(again.card).toMatchObject({ quantity: 2, serialNumber: null });
    expect(listCards().map((c) => `${c.serialNumber ?? "base"}:${c.quantity}`).sort()).toEqual(["7/25:1", "base:2"]);
  });

  it("stacks base copies together and keeps a parallel apart from them", async () => {
    const { intakeCard } = await import("@/lib/cards");
    expect(intakeCard({ ...trout }).result).toBe("created");
    expect(intakeCard({ ...trout }).result).toBe("merged");
    expect(intakeCard({ ...trout, parallel: "Refractor" }).result).toBe("created");
    expect(intakeCard({ ...trout, parallel: " refractor " }).result).toBe("merged");
    expect(intakeCard({ ...trout, parallel: "Gold   Refractor" }).result).toBe("created");
    expect(intakeCard({ ...trout, parallel: "gold refractor" }).result).toBe("merged");
    const cards = listCards();
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.quantity)).toEqual([2, 2, 2]);
    // Each of the three took its copy from its own purchase lot.
    expect(cards.every((c) => listLots(c.id).length === 2)).toBe(true);
  });

  it("still keeps a slab, a variant and a language apart on top of that", async () => {
    const { intakeCard } = await import("@/lib/cards");
    createCard({ ...trout, parallel: "Refractor", gradingCompany: "PSA", grade: "9" });
    // Same parallel, but a raw copy of it is not the slab: stops and asks, as it always did.
    expect(intakeCard({ ...trout, parallel: "Refractor" }).result).toBe("ambiguous");
    expect(intakeCard({ ...trout, parallel: "Refractor", gradingCompany: "PSA", grade: "9" }).result).toBe("merged");
    expect(listCards()).toHaveLength(1);
  });

  it("says which copies may share a row", async () => {
    const { mayShareRow } = await import("@/lib/cards");
    const base = { serialNumber: null, parallel: null };
    expect(mayShareRow(base, { serialNumber: null, parallel: null })).toBe(true);
    expect(mayShareRow({ serialNumber: null, parallel: "Gold Refractor" }, { serialNumber: "", parallel: "  gold refractor" })).toBe(true);
    expect(mayShareRow(base, { serialNumber: "12/99", parallel: null })).toBe(false);
    expect(mayShareRow({ serialNumber: "12/99", parallel: null }, base)).toBe(false);
    expect(mayShareRow({ serialNumber: "12/99", parallel: null }, { serialNumber: "12 of 99", parallel: null })).toBe(false);
    expect(mayShareRow(base, { parallel: "Refractor" })).toBe(false);
    expect(mayShareRow({ serialNumber: null, parallel: "Refractor" }, {})).toBe(false);
  });

  it("adds the new columns to a database from before they existed, and does so once", () => {
    const older = openDatabase(":memory:");
    for (const column of SPORTS_COLUMNS) older.exec(`ALTER TABLE cards DROP COLUMN ${column}`);
    older.exec("INSERT INTO cards (game, name, created_at, updated_at) VALUES ('sports', 'Ken Griffey Jr.', '2020-01-01', '2020-01-01')");
    older.exec("INSERT INTO cards (game, name, centering, created_at, updated_at) VALUES ('sports', 'Frank Thomas', '{\"front\":{\"lr\":[55,45],\"tb\":null},\"back\":{\"lr\":null,\"tb\":null}}', '2020-01-02', '2020-01-02')");
    initializeDatabase(older);
    // Opening it again is not a second migration.
    expect(() => initializeDatabase(older)).not.toThrow();
    setDb(older);
    const columns = (getDb().prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(SPORTS_COLUMNS));
    expect(columns.filter((c) => SPORTS_COLUMNS.includes(c))).toHaveLength(SPORTS_COLUMNS.length);
    expect(listCards().find((c) => c.name === "Ken Griffey Jr.")).toMatchObject({ team: null, rookie: false, parallel: null, serialNumber: null, autograph: false, relic: false, subgrades: null });
    // What the older rows already held is untouched by the migration.
    expect(listCards().find((c) => c.name === "Frank Thomas")?.centering).toEqual({ front: { lr: [55, 45], tb: null }, back: { lr: null, tb: null } });
    expect(createCard({ ...trout, serialNumber: "1/1" }).serialNumber).toBe("1/1");
  });

  it("reads a row a restore left in a shape the write path would refuse", () => {
    const card = createCard({ ...trout });
    const row = (set: string, ...values: unknown[]) => getDb().prepare(`UPDATE cards SET ${set} WHERE id = ?`).run(...values, card.id);
    row("rookie = ?, autograph = ?, relic = ?, serial_number = ?, subgrades = ?", "yes", "", 2, " 12 of 99 ", '{"centering":9.5,"corners":99,"edges":"x","surface":null}');
    expect(getCard(card.id)).toMatchObject({ rookie: false, autograph: false, relic: false, serialNumber: "12/99", subgrades: { centering: 9.5, corners: null, edges: null, surface: null } });
    // JSON that is not an object, and one that is not JSON, are no subgrades and do not stop the page.
    for (const stored of ["7", '"9"', "[9,9,9,9]", "null", "{not json"]) {
      row("subgrades = ?", stored);
      expect(getCard(card.id)?.subgrades, stored).toBeNull();
    }
    row("serial_number = ?", "   ");
    expect(getCard(card.id)?.serialNumber).toBeNull();
  });
});
