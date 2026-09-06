import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { addSnapshot, createCard, deleteCard, getCard, latestSnapshotsByCard, listCards, listSnapshots, updateCard } from "@/lib/cards";
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

describe("settings", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("returns defaults and merges saved values", () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings({ gradeMultipliers: { "PSA 10": 4, " bad": -1 as number, "": 2 }, conditionMultipliers: { ...DEFAULT_SETTINGS.conditionMultipliers, LP: 0.9 }, gradingFee: 30 });
    const s = getSettings();
    expect(s.gradeMultipliers).toEqual({ "PSA 10": 4 });
    expect(s.conditionMultipliers.LP).toBe(0.9);
    expect(s.conditionMultipliers.NM).toBe(1);
    expect(s.gradingFee).toBe(30);
  });
});
