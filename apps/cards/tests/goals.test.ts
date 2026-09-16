import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { createCard, updateCard } from "@/lib/cards";
import { deleteGoal, getGoal, goalFromChecklist, listGoals, saveGoal, saveGoalItem } from "@/lib/goals";
import { normalizeGoal, normalizeGoalItem } from "@/lib/goals/domain";
import { goalFiles, importGoalMarkdown, mirrorGoals } from "@/lib/goals/markdown";
import { collectionFiles, readCardFiles } from "@/lib/markdown/mirror";
import { importCardFiles } from "@/lib/markdown/restore";
import { ownedFromChecklist, refreshChecklist, saveChecklist, setProgress } from "@/lib/sets";
import { fakeFetch } from "./helpers";

beforeEach(() => setDb(openDatabase(":memory:")));
const wanted = { game: "pokemon", name: "Pikachu", setName: "Base", cardNumber: "58" };

describe("collecting goals", () => {
  it("counts held copies, caps targets and follows sales/count corrections without adding inventory", () => {
    const goal = saveGoal({ name: "Favorites", budget: 50 });
    saveGoalItem(goal.id, { ...wanted, quantity: 2, unitBudget: 20 });
    expect(getGoal(goal.id)).toMatchObject({ wanted: 2, owned: 0, remainingBudget: 40 });
    const card = createCard({ ...wanted, game: "pokemon", quantity: 3 });
    expect(getGoal(goal.id)).toMatchObject({ owned: 2, remainingBudget: 0 });
    updateCard(card.id, { quantity: 0 });
    expect(getGoal(goal.id)).toMatchObject({ owned: 0, remainingBudget: 40 });
    updateCard(card.id, { quantity: 1 });
    expect(getGoal(goal.id)).toMatchObject({ owned: 1, remainingBudget: 20 });
  });
  it("merges repeated targets without double counting, and keeps unknown budgets unknown", () => {
    const goal = saveGoal({ name: "Favorites" });
    const first = saveGoalItem(goal.id, { ...wanted, quantity: 2 });
    const again = saveGoalItem(goal.id, { ...wanted, quantity: 1 });
    expect(again.id).toBe(first.id);
    expect(getGoal(goal.id)).toMatchObject({ wanted: 2, owned: 0, unbudgeted: 1, remainingBudget: 0 });
    expect(getGoal(goal.id)?.items).toHaveLength(1);
    expect(listGoals()).toHaveLength(1);
  });
  it("does not count a different printing or ambiguous numberless card", () => {
    const goal = saveGoal({ name: "Printings" });
    saveGoalItem(goal.id, wanted);
    saveGoalItem(goal.id, { ...wanted, cardNumber: "59" });
    createCard({ ...wanted, game: "pokemon", cardNumber: "60" });
    createCard({ ...wanted, game: "pokemon", cardNumber: null });
    expect(getGoal(goal.id)?.owned).toBe(0);
    createCard({ ...wanted, game: "pokemon", cardNumber: "58/102" });
    expect(getGoal(goal.id)?.owned).toBe(1);
  });
  it("respects printing and language requirements and archives without losing items", () => {
    const goal = saveGoal({ name: "Foils" });
    saveGoalItem(goal.id, { ...wanted, variant: "holo", language: "Japanese" });
    createCard({ ...wanted, game: "pokemon", variant: "holo", language: "English" });
    expect(getGoal(goal.id)?.owned).toBe(0);
    createCard({ ...wanted, game: "pokemon", variant: "holo", language: "Japanese" });
    saveGoal({ ...goal, archived: true }, goal.id);
    expect(getGoal(goal.id)).toMatchObject({ owned: 1, archived: true });
  });
  it("allocates a physical copy once per goal, satisfying specific printings first", () => {
    const goal = saveGoal({ name: "Printings" });
    saveGoalItem(goal.id, wanted);
    const holo = saveGoalItem(goal.id, { ...wanted, variant: "holo" });
    createCard({ ...wanted, game: "pokemon", variant: "holo", quantity: 1 });
    expect(getGoal(goal.id)?.owned).toBe(1);
    expect(getGoal(goal.id)?.items.find((item) => item.id === holo.id)?.owned).toBe(1);
    const independent = saveGoal({ name: "A second goal" }); saveGoalItem(independent.id, wanted);
    expect(getGoal(independent.id)?.owned).toBe(1);
  });
  it("refuses invalid dates, negative budgets and fractional quantities", () => {
    expect(() => normalizeGoal({ name: "Goal", targetDate: "2026-02-30" })).toThrow("date");
    expect(() => normalizeGoal({ name: "Goal", budget: -1 })).toThrow("Budget");
    expect(() => normalizeGoalItem({ ...wanted, quantity: 1.2 })).toThrow("quantity");
    expect(() => normalizeGoalItem({ ...wanted, game: "constructor" })).toThrow("game");
  });
  it("requires evidence of an explicit set code when no set name is supplied", () => {
    const goal = saveGoal({ name: "A specific set" });
    saveGoalItem(goal.id, { game: "mtg", name: "Lightning Bolt", setCode: "lea", cardNumber: "161" });
    createCard({ game: "mtg", name: "Lightning Bolt", cardNumber: "161" });
    expect(getGoal(goal.id)?.owned).toBe(0);
    createCard({ game: "mtg", name: "Lightning Bolt", setCode: "LEA", cardNumber: "161" });
    expect(getGoal(goal.id)?.owned).toBe(1);
  });
});

describe("goal portability", () => {
  it("roundtrips goals with notes and budgets through the collection Markdown import idempotently", () => {
    const goal = saveGoal({ name: "Favorites", budget: 99, targetDate: "2026-12-31" });
    saveGoalItem(goal.id, { ...wanted, notes: "A | B\nwith a note", unitBudget: 12, priority: "high" });
    const files = readCardFiles();
    expect(collectionFiles().some((file) => file.name.startsWith("goals/"))).toBe(true);
    setDb(openDatabase(":memory:"));
    expect(importCardFiles(files)).toMatchObject({ goals: 1, skipped: [] });
    expect(importCardFiles(files)).toMatchObject({ goals: 1, skipped: [] });
    expect(listGoals()).toHaveLength(1);
    expect(getGoal(goal.id)).toMatchObject({ budget: 99, items: [{ notes: "A | B\nwith a note", priority: "high", unitBudget: 12 }] });
  });
  it("preserves an orphan file on an empty-database rewrite, but removes explicitly deleted goals", () => {
    const goal = saveGoal({ name: "Saved elsewhere" });
    const file = goalFiles()[0]!;
    setDb(openDatabase(":memory:")); mirrorGoals();
    expect(fs.existsSync(file.path)).toBe(true);
    importGoalMarkdown(fs.readFileSync(file.path, "utf8"));
    expect(deleteGoal(goal.id)).toBe(true);
    expect(fs.existsSync(file.path)).toBe(false);
  });
  it("rejects an invalid goal atomically without replacing its existing wanted cards", () => {
    const goal = saveGoal({ name: "Existing" });
    saveGoalItem(goal.id, wanted);
    const text = fs.readFileSync(goalFiles()[0]!.path, "utf8").replace('"quantity": 1', '"quantity": -1');
    expect(() => importGoalMarkdown(text)).toThrow("quantity");
    expect(getGoal(goal.id)?.items).toHaveLength(1);
  });
});

describe("set planning", () => {
  const checklist = { game: "pokemon" as const, setId: "base1", setName: "Base", cards: [{ number: "58", name: "Pikachu", rarity: null, imageUrl: null }, { number: "59", name: "Pikachu", rarity: null, imageUrl: null }] };
  it("fetches and lists a set with zero owned cards, and turns its checklist into a goal", async () => {
    await refreshChecklist("pokemon", "Base", fakeFetch([["v2/sets?", { data: [{ id: "base1", name: "Base" }] }], ["v2/cards?", { data: checklist.cards }]]));
    expect(setProgress()).toMatchObject([{ owned: 0, total: 2, missing: 2 }]);
    expect(goalFromChecklist("pokemon", "base1")).toMatchObject({ wanted: 2, owned: 0 });
  });
  it("counts unique checklist hits instead of owned rows and never falls back past a conflicting number", () => {
    saveChecklist(checklist);
    const wrong = createCard({ ...wanted, game: "pokemon", cardNumber: "60" });
    expect(ownedFromChecklist(checklist, [wrong]).size).toBe(0);
    createCard({ ...wanted, game: "pokemon", grade: "9", gradingCompany: "PSA" });
    createCard({ ...wanted, game: "pokemon", quantity: 3 });
    expect(setProgress()).toMatchObject([{ owned: 1, total: 2, missing: 1, copies: 5 }]);
  });
});
