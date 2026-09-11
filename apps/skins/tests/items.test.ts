import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import {
  addAcquisition,
  createItem,
  deleteItem,
  findByAssetId,
  getItem,
  intakeItem,
  isTradeLocked,
  listItems,
  listStorageUnits,
  normalizeInput,
  updateItem,
} from "@/lib/items";
import { listLots, verifyLotInvariant } from "@/lib/acquisitions";
import { clutchCase, redline, seedCase, seedRedline } from "./helpers";

beforeEach(() => setDb(openDatabase(":memory:")));

describe("normalizing what a client sends", () => {
  it("insists on a market hash name", () => {
    expect(() => normalizeInput({ marketHashName: "   " })).toThrow(/market hash name/i);
  });

  it("refuses a category, rarity or exterior it does not know", () => {
    expect(() => normalizeInput({ marketHashName: "x", category: "spaceship" as never })).toThrow(/category/i);
    expect(() => normalizeInput({ marketHashName: "x", rarity: "shiny" as never })).toThrow(/rarity/i);
    expect(() => normalizeInput({ marketHashName: "x", exterior: "pristine" as never })).toThrow(/exterior/i);
  });

  it("does not let a prototype property pass as a category", () => {
    expect(() => normalizeInput({ marketHashName: "x", category: "constructor" as never })).toThrow(/category/i);
    expect(() => normalizeInput({ marketHashName: "x", category: "toString" as never })).toThrow(/category/i);
  });

  it("derives stackability from the category rather than trusting the caller", () => {
    expect(normalizeInput({ marketHashName: "x", category: "weapon" }).stackable).toBe(false);
    expect(normalizeInput({ marketHashName: "x", category: "case" }).stackable).toBe(true);
  });

  it("lets the float decide the exterior when the two disagree", () => {
    // The tier in an item's name is derived from its float, so a file or an
    // import claiming otherwise is describing an impossible object.
    const item = normalizeInput({ marketHashName: "x", category: "weapon", floatValue: 0.5, exterior: "factory_new" });
    expect(item.exterior).toBe("battle_scarred");
  });

  it("keeps a stated exterior when there is no float to check it against", () => {
    expect(normalizeInput({ marketHashName: "x", category: "weapon", exterior: "minimal_wear" }).exterior).toBe("minimal_wear");
  });

  it("drops a float that is not a wear value", () => {
    expect(normalizeInput({ marketHashName: "x", category: "weapon", floatValue: 4 }).floatValue).toBeNull();
    expect(normalizeInput({ marketHashName: "x", category: "weapon", floatValue: -1 }).floatValue).toBeNull();
  });

  it("caps a unique item at one copy", () => {
    // Three copies of one float and one pattern is not a thing that can exist.
    expect(normalizeInput({ marketHashName: "x", category: "knife", quantity: 3 }).quantity).toBe(1);
    expect(normalizeInput({ marketHashName: "x", category: "case", quantity: 3 }).quantity).toBe(3);
  });

  it("stores only an inspect link that is really one", () => {
    const real = "steam://rungame/730/76561202255233023/+csgo_econ_action_preview S1A2D3";
    expect(normalizeInput({ marketHashName: "x", inspectLink: real }).inspectLink).toBe(real);
    expect(normalizeInput({ marketHashName: "x", inspectLink: "javascript:alert(1)" }).inspectLink).toBeNull();
    expect(normalizeInput({ marketHashName: "x", inspectLink: "https://example.com" }).inspectLink).toBeNull();
  });

  it("stores only an http image url", () => {
    expect(normalizeInput({ marketHashName: "x", imageUrl: "https://cdn/x.png" }).imageUrl).toBe("https://cdn/x.png");
    expect(normalizeInput({ marketHashName: "x", imageUrl: "javascript:alert(1)" }).imageUrl).toBeNull();
  });

  it("keeps stickers in slot order and drops the ones with no name", () => {
    const item = normalizeInput({
      marketHashName: "x",
      stickers: [
        { slot: 2, name: "Titan | Katowice 2014", marketHashName: null, wear: 0 },
        { slot: 0, name: "iBUYPOWER | Katowice 2014", marketHashName: null, wear: 0.4 },
        { slot: 1, name: "  ", marketHashName: null, wear: null },
      ],
    });
    expect(item.stickers.map((s) => s.slot)).toEqual([0, 2]);
    expect(item.stickers[0].name).toContain("iBUYPOWER");
  });
});

describe("creating an item", () => {
  it("opens a purchase lot for the copies it brings in", () => {
    const item = seedCase({ quantity: 4, purchasePrice: 0.9 });
    const lots = listLots(item.id);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ quantity: 4, remaining: 4, unitCost: 0.9 });
    expect(verifyLotInvariant()).toEqual([]);
  });

  it("records a copy with no price as unknown rather than free", () => {
    const item = seedCase();
    expect(listLots(item.id)[0].unitCost).toBeNull();
    expect(item.purchasePrice).toBeNull();
  });

  it("keeps the stickers it was given", () => {
    const item = seedRedline({
      stickers: [{ slot: 0, name: "Crown (Foil)", marketHashName: "Sticker | Crown (Foil)", wear: 0.12 }],
    });
    expect(getItem(item.id)!.stickers).toEqual([
      { slot: 0, name: "Crown (Foil)", marketHashName: "Sticker | Crown (Foil)", wear: 0.12 },
    ]);
  });
});

describe("intake", () => {
  it("merges a second case into the stack it already has", () => {
    seedCase({ quantity: 2, purchasePrice: 0.5 });
    const outcome = intakeItem(clutchCase({ quantity: 3, purchasePrice: 1.5 }));
    expect(outcome.result).toBe("merged");
    expect(listItems()).toHaveLength(1);
    const item = listItems()[0];
    expect(item.quantity).toBe(5);
    // Two purchases at two prices, kept apart.
    expect(listLots(item.id).map((l) => l.unitCost)).toEqual([0.5, 1.5]);
    // The average of what is held, not of the two prices.
    expect(item.purchasePrice).toBeCloseTo((2 * 0.5 + 3 * 1.5) / 5, 10);
  });

  it("never merges two weapons, however alike their names", () => {
    // Same skin, same wear tier, different objects: different float, different
    // pattern, different price. Merging them would lose one.
    seedRedline({ floatValue: 0.16, paintSeed: 1 });
    const outcome = intakeItem(redline({ floatValue: 0.37, paintSeed: 2 }));
    expect(outcome.result).toBe("created");
    expect(listItems()).toHaveLength(2);
  });

  it("recognises the same Steam object on a second import", () => {
    const first = intakeItem(redline({ assetId: "44112233", storageUnit: "Backpack" }));
    expect(first.result).toBe("created");
    const again = intakeItem(redline({ assetId: "44112233", storageUnit: "Storage Unit 1" }));
    expect(again.result).toBe("updated");
    expect(listItems()).toHaveLength(1);
    expect(findByAssetId("44112233")!.storageUnit).toBe("Storage Unit 1");
  });

  it("keeps what the owner filled in when the same object is read again", () => {
    const { item } = intakeItem(redline({ assetId: "44112233" }));
    updateItem(item.id, { notes: "birthday present", storageUnit: "Storage Unit 1", purchasePrice: 38 });
    // A parser emits every key it has a slot for; the blanks are what it does
    // not know, not instructions to forget.
    const again = intakeItem(redline({ assetId: "44112233", notes: null, storageUnit: null, purchasePrice: null, rarity: null }));
    expect(again.result).toBe("updated");
    const kept = getItem(item.id)!;
    expect(kept.notes).toBe("birthday present");
    expect(kept.storageUnit).toBe("Storage Unit 1");
    expect(kept.purchasePrice).toBe(38);
    expect(kept.rarity).toBe("classified");
  });

  it("keeps the quantity right after a merge", () => {
    seedCase({ quantity: 2 });
    intakeItem(clutchCase({ quantity: 1 }));
    expect(verifyLotInvariant()).toEqual([]);
  });
});

describe("editing an item", () => {
  it("reconciles the lots when the count is typed in directly", () => {
    const item = seedCase({ quantity: 5, purchasePrice: 1 });
    updateItem(item.id, { quantity: 8 });
    expect(verifyLotInvariant()).toEqual([]);
    // The three extra copies came from nowhere, so their cost is unknown.
    expect(listLots(item.id).find((l) => l.unitCost === null)?.remaining).toBe(3);
  });

  it("lets the price be edited while there is only one purchase", () => {
    const item = seedCase({ quantity: 2, purchasePrice: 1 });
    expect(updateItem(item.id, { purchasePrice: 4 })!.purchasePrice).toBe(4);
  });

  it("keeps the average once there is more than one purchase", () => {
    const item = seedCase({ quantity: 1, purchasePrice: 1 });
    addAcquisition(item.id, { quantity: 1, unitCost: 3 });
    // With two lots the price is derived, so a typed-in number cannot overwrite
    // what the two purchases actually cost.
    expect(updateItem(item.id, { purchasePrice: 99 })!.purchasePrice).toBe(2);
  });

  it("refuses a second copy of a unique object", () => {
    const item = seedRedline();
    expect(() => addAcquisition(item.id, { quantity: 1, unitCost: 10 })).toThrow(/separate item/i);
  });

  it("replaces the stickers only when asked to", () => {
    const item = seedRedline({ stickers: [{ slot: 0, name: "Crown", marketHashName: null, wear: null }] });
    expect(updateItem(item.id, { notes: "scraped" })!.stickers).toHaveLength(1);
    expect(updateItem(item.id, { stickers: [] })!.stickers).toHaveLength(0);
  });
});

describe("listing", () => {
  it("filters by the things a CS2 inventory is actually sorted by", () => {
    seedRedline({ exterior: "field_tested" });
    seedRedline({ marketHashName: "AWP | Asiimov (Field-Tested)", floatValue: 0.3, stattrak: true, rarity: "covert" });
    seedCase({ quantity: 9 });
    expect(listItems({ category: "case" })).toHaveLength(1);
    expect(listItems({ stattrak: true })).toHaveLength(1);
    expect(listItems({ rarity: "covert" })).toHaveLength(1);
    expect(listItems({ exterior: "field_tested" })).toHaveLength(2);
  });

  it("searches for the characters typed, not for wildcards", () => {
    seedRedline({ marketHashName: "AK-47 | Redline (Field-Tested)" });
    seedRedline({ marketHashName: "AK-47 | Redline (Minimal Wear)", floatValue: 0.1 });
    expect(listItems({ search: "Red_ine" })).toHaveLength(0);
    expect(listItems({ search: "Redline" })).toHaveLength(2);
  });

  it("returns items saved in the same tick in a settled order", () => {
    const a = seedCase({ marketHashName: "Case A" });
    const b = seedCase({ marketHashName: "Case B" });
    // Force the collision the millisecond clock only sometimes produces.
    getDb().prepare("UPDATE items SET updated_at = ?").run("2026-01-01T00:00:00.000Z");
    expect(listItems().map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it("counts what is kept where", () => {
    seedCase({ storageUnit: "Storage Unit 1" });
    seedRedline({ storageUnit: "Storage Unit 1" });
    seedRedline({ marketHashName: "M4A4 | Howl (Field-Tested)", storageUnit: "Backpack" });
    expect(listStorageUnits()).toEqual([
      { storageUnit: "Backpack", items: 1 },
      { storageUnit: "Storage Unit 1", items: 2 },
    ]);
  });

  it("finds what is still trade locked", () => {
    const soon = new Date(Date.now() + 5 * 864e5).toISOString();
    const past = new Date(Date.now() - 864e5).toISOString();
    seedRedline({ tradableAfter: soon });
    seedCase({ tradableAfter: past });
    const locked = listItems({ lockedOnly: true });
    expect(locked).toHaveLength(1);
    expect(isTradeLocked(locked[0])).toBe(true);
  });
});

describe("deleting", () => {
  it("takes the stickers and lots with it", () => {
    const item = seedRedline({ stickers: [{ slot: 0, name: "Crown", marketHashName: null, wear: null }] });
    expect(deleteItem(item.id)).toBe(true);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM item_stickers").get()).toEqual({ n: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM acquisitions").get()).toEqual({ n: 0 });
  });
});

describe("the asset id index", () => {
  it("refuses to hold the same Steam object twice", () => {
    createItem(redline({ assetId: "999" }));
    expect(() => createItem(redline({ assetId: "999", floatValue: 0.3 }))).toThrow();
  });

  it("does not treat two items with no asset id as the same", () => {
    seedRedline();
    expect(() => seedRedline({ floatValue: 0.3 })).not.toThrow();
    expect(listItems()).toHaveLength(2);
  });
});
