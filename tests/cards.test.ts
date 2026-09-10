import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { addSnapshot, createCard, deleteCard, findSimilar, getCard, latestSnapshotsByCard, listCards, listSnapshots, updateCard } from "@/lib/cards";
import { getSettings, saveSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS, type PriceSummary } from "@/lib/types";

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
