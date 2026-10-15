import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { addSnapshot, createCard, deleteCard, findSimilar, getCard, intakeCard, latestSnapshotsByCard, listCards, listSnapshots, updateCard } from "@/lib/cards";
import { recordSale } from "@/lib/sales";
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


describe("sports cards", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  const trout = { game: "sports", sport: "baseball", name: "Mike Trout", setName: "Topps Chrome", cardNumber: "US175", year: 2011 } as const;

  it("keeps the team, the flags, the parallel, the numbering and BGS subgrades", () => {
    const card = createCard({ ...trout, team: "Los Angeles Angels", rookie: "yes" as never, parallel: "Gold Refractor", serialNumber: "12 of 50", autograph: true, relic: 0 as never, gradingCompany: "BGS", grade: "9.5", subgrades: { centering: "9.5", corners: 9, edges: "10", surface: null } as never });
    expect(card).toMatchObject({ team: "Los Angeles Angels", rookie: true, parallel: "Gold Refractor", serialNumber: "12/50", autograph: true, relic: false, subgrades: { centering: 9.5, corners: 9, edges: 10, surface: null } });
    expect(getCard(card.id)).toMatchObject({ rookie: true, autograph: true, relic: false, subgrades: { centering: 9.5 } });
    const plain = createCard({ ...trout });
    expect(plain).toMatchObject({ team: null, rookie: false, parallel: null, serialNumber: null, autograph: false, relic: false, subgrades: null });
    // Subgrades outside the scale, or an empty set, are no subgrades.
    expect(createCard({ ...trout, subgrades: { centering: 11, corners: null, edges: null, surface: null } }).subgrades).toBeNull();
  });

  it("never merges a serial-numbered card, and never merges into one", async () => {
    const first = intakeCard({ ...trout, parallel: "Gold Refractor", serialNumber: "12/50" });
    const second = intakeCard({ ...trout, parallel: "Gold Refractor", serialNumber: "12/50" });
    expect(first.result).toBe("created");
    expect(second.result).toBe("created");
    // A copy of the same parallel without numbering is not a copy of a numbered one either.
    expect(intakeCard({ ...trout, parallel: "Gold Refractor" }).result).toBe("created");
    expect(listCards()).toHaveLength(3);
  });

  it("stacks base copies together and keeps a parallel apart from them", async () => {
    expect(intakeCard({ ...trout }).result).toBe("created");
    expect(intakeCard({ ...trout }).result).toBe("merged");
    expect(intakeCard({ ...trout, parallel: "Refractor" }).result).toBe("created");
    expect(intakeCard({ ...trout, parallel: "refractor" }).result).toBe("merged");
    const cards = listCards();
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.quantity).sort()).toEqual([2, 2]);
  });

  it("adds the new columns to a database from before they existed", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cc-migrate-")), "old.db");
    const older = openDatabase(file);
    for (const column of ["team", "rookie", "parallel", "serial_number", "autograph", "relic", "subgrades"]) older.exec(`ALTER TABLE cards DROP COLUMN ${column}`);
    older.exec("INSERT INTO cards (game, name, created_at, updated_at) VALUES ('sports', 'Ken Griffey Jr.', '2020-01-01', '2020-01-01')");
    older.close();
    setDb(openDatabase(file));
    const columns = (getDb().prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(["team", "rookie", "parallel", "serial_number", "autograph", "relic", "subgrades"]));
    expect(listCards()[0]).toMatchObject({ name: "Ken Griffey Jr.", team: null, rookie: false, subgrades: null });
    getDb().close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
