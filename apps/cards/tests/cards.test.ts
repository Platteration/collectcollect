import { beforeEach, describe, expect, it } from "vitest";
import { getDb, initializeDatabase, openDatabase, setDb } from "@/lib/db";
import { HasSalesError, addAcquisition, addSnapshot, allSnapshots, collectionTotals, countCards, createCard, deleteCard, findSimilar, getCard, latestSnapshotsByCard, latestValuesByCard, listCards, listSnapshots, markChecked, recentSnapshotsByCard, snapshotValues, updateCard } from "@/lib/cards";
import { verifyLotInvariant } from "@/lib/acquisitions";
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
