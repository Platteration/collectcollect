import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { addAcquisition, createCard, getCard, intakeCard, listCards, removeAcquisition, updateCard } from "@/lib/cards";
import { costBasis, listLots, listSaleLots, verifyLotInvariant } from "@/lib/acquisitions";
import { deleteSale, listSalesForCard, recordSale } from "@/lib/sales";
import { realizedReturn } from "@/lib/analytics";

const lots = (cardId: number) => listLots(cardId).map((l) => ({ quantity: l.quantity, remaining: l.remaining, unitCost: l.unitCost }));

describe("what each copy cost", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("opens a lot for the copies a card is added with", () => {
    const card = createCard({ game: "pokemon", name: "Charizard", quantity: 2, purchasePrice: 250 });
    expect(lots(card.id)).toEqual([{ quantity: 2, remaining: 2, unitCost: 250 }]);
    // A card added without a price has copies whose cost nobody knows, which is
    // not the same as copies that were free.
    const gift = createCard({ game: "pokemon", name: "Pikachu" });
    expect(lots(gift.id)).toEqual([{ quantity: 1, remaining: 1, unitCost: null }]);
    expect(costBasis(gift.id)).toMatchObject({ invested: 0, copiesWithCost: 0, copiesWithoutCost: 1 });
    // Nothing owned, nothing to account for.
    const none = createCard({ game: "pokemon", name: "Wishlist", quantity: 0 });
    expect(lots(none.id)).toEqual([]);
  });

  it("records a second copy at what the second copy cost", () => {
    // The bug this feature exists for: buying another at a different price used
    // to keep only the first price.
    const card = createCard({ game: "pokemon", name: "Charizard", setName: "Base Set", purchasePrice: 100 });
    const merged = intakeCard({ game: "pokemon", name: "Charizard", setName: "Base Set", purchasePrice: 300 });
    expect(merged.result).toBe("merged");
    expect(lots(card.id)).toEqual([
      { quantity: 1, remaining: 1, unitCost: 100 },
      { quantity: 1, remaining: 1, unitCost: 300 },
    ]);
    expect(costBasis(card.id)).toMatchObject({ invested: 400, copiesWithCost: 2 });
    // The card's own price is now the average of what is held.
    expect(getCard(card.id)?.purchasePrice).toBe(200);
    expect(getCard(card.id)?.quantity).toBe(2);
  });

  it("adds copies bought later without touching the ones already held", () => {
    const card = createCard({ game: "pokemon", name: "Snorlax", purchasePrice: 40 });
    const after = addAcquisition(card.id, { quantity: 3, unitCost: 60, source: "card show" })!;
    expect(after.quantity).toBe(4);
    expect(lots(card.id)).toEqual([
      { quantity: 1, remaining: 1, unitCost: 40 },
      { quantity: 3, remaining: 3, unitCost: 60 },
    ]);
    expect(costBasis(card.id).invested).toBe(220);
  });

  it("takes the copies held longest when one is sold", () => {
    const card = createCard({ game: "pokemon", name: "Charizard", purchasePrice: 100 });
    addAcquisition(card.id, { quantity: 1, unitCost: 300 });
    const sale = recordSale(card.id, { quantity: 1, unitPrice: 500 });
    // Sold the older copy, so the basis is what that one cost — not an average
    // of the two, and not the price of the one still in the binder.
    expect(sale.unitCost).toBe(100);
    expect(lots(card.id)).toEqual([
      { quantity: 1, remaining: 0, unitCost: 100 },
      { quantity: 1, remaining: 1, unitCost: 300 },
    ]);
    expect(getCard(card.id)?.quantity).toBe(1);
    expect(getCard(card.id)?.purchasePrice).toBe(300);
  });

  it("blends the cost when one sale spans two purchases", () => {
    const card = createCard({ game: "pokemon", name: "Charizard", purchasePrice: 100 });
    addAcquisition(card.id, { quantity: 1, unitCost: 200 });
    const sale = recordSale(card.id, { quantity: 2, unitPrice: 400 });
    expect(sale.unitCost).toBe(150);
    expect(realizedReturn(listSalesForCard(card.id))).toMatchObject({ cost: 300, proceeds: 800, gain: 500 });
  });

  it("will not put a number on a sale that took a copy of unknown cost", () => {
    const card = createCard({ game: "pokemon", name: "Shoebox find", quantity: 2 });
    updateCard(card.id, { purchasePrice: null });
    const sale = recordSale(card.id, { quantity: 1, unitPrice: 50 });
    // Half a basis reported as a whole one would understate the cost while
    // looking complete, which is the mistake this whole feature removes.
    expect(sale.unitCost).toBeNull();
    expect(realizedReturn(listSalesForCard(card.id))).toMatchObject({ withoutCost: 1, cost: 0 });
  });

  it("puts the very copies it took back when a sale is undone", () => {
    const card = createCard({ game: "pokemon", name: "Charizard", purchasePrice: 100 });
    addAcquisition(card.id, { quantity: 1, unitCost: 300 });
    const sale = recordSale(card.id, { quantity: 1, unitPrice: 500 });
    expect(listSaleLots(sale.id)).toHaveLength(1);

    deleteSale(sale.id);
    expect(lots(card.id)).toEqual([
      { quantity: 1, remaining: 1, unitCost: 100 },
      { quantity: 1, remaining: 1, unitCost: 300 },
    ]);
    expect(getCard(card.id)?.quantity).toBe(2);
    expect(getCard(card.id)?.purchasePrice).toBe(200);
  });

  it("reads a quantity typed into the form as a correction, not a purchase", () => {
    const card = createCard({ game: "pokemon", name: "Snorlax", quantity: 3, purchasePrice: 10 });
    updateCard(card.id, { quantity: 5 });
    // Two more copies appeared with no price attached. Pricing them at the
    // average would let a typo inflate what the collection cost.
    expect(lots(card.id)).toEqual([
      { quantity: 3, remaining: 3, unitCost: 10 },
      { quantity: 2, remaining: 2, unitCost: null },
    ]);
    expect(costBasis(card.id)).toMatchObject({ invested: 30, copiesWithCost: 3, copiesWithoutCost: 2 });
  });

  it("lands exactly back where it started when a quantity typo is undone", () => {
    const card = createCard({ game: "pokemon", name: "Snorlax", quantity: 3, purchasePrice: 10 });
    const before = lots(card.id);
    updateCard(card.id, { quantity: 5 });
    updateCard(card.id, { quantity: 3 });
    expect(lots(card.id)).toEqual(before);
    expect(getCard(card.id)?.purchasePrice).toBe(10);
  });

  it("takes a reduction off the newest copies and leaves sold history alone", () => {
    const card = createCard({ game: "pokemon", name: "Charizard", purchasePrice: 100 });
    addAcquisition(card.id, { quantity: 2, unitCost: 300 });
    recordSale(card.id, { quantity: 1, unitPrice: 500 }); // takes the 100 copy
    updateCard(card.id, { quantity: 1 });
    // The lot a sale drew from keeps its record; the newest copies go first.
    expect(lots(card.id)).toEqual([
      { quantity: 1, remaining: 0, unitCost: 100 },
      { quantity: 1, remaining: 1, unitCost: 300 },
    ]);
    expect(listSalesForCard(card.id)[0].unitCost).toBe(100);
  });

  it("refuses to unpick a purchase that has already been sold from", () => {
    const card = createCard({ game: "pokemon", name: "Charizard", purchasePrice: 100 });
    recordSale(card.id, { quantity: 1, unitPrice: 500 });
    const lot = listLots(card.id)[0];
    expect(() => removeAcquisition(lot.id)).toThrow(/already been sold/);
  });

  it("gives a card back its price when the last copy is sold", () => {
    const card = createCard({ game: "pokemon", name: "Charizard", purchasePrice: 100 });
    recordSale(card.id, { quantity: 1, unitPrice: 500 });
    // Nothing is held, but what it cost is still part of the record.
    expect(getCard(card.id)).toMatchObject({ quantity: 0, purchasePrice: 100 });
  });

  it("keeps every card's quantity equal to the copies left in its lots", () => {
    const a = createCard({ game: "pokemon", name: "Charizard", setName: "Base Set", quantity: 2, purchasePrice: 100 });
    const b = createCard({ game: "mtg", name: "Black Lotus", purchasePrice: 4000 });
    intakeCard({ game: "pokemon", name: "Charizard", setName: "Base Set", purchasePrice: 150 });
    addAcquisition(b.id, { quantity: 2, unitCost: 5000 });
    updateCard(a.id, { quantity: 6 });
    updateCard(a.id, { quantity: 4 });
    const sale = recordSale(a.id, { quantity: 2, unitPrice: 400 });
    recordSale(b.id, { quantity: 1, unitPrice: 9000 });
    deleteSale(sale.id);
    removeAcquisition(listLots(b.id)[1].id);
    expect(verifyLotInvariant()).toEqual([]);
    expect(listCards().every((c) => c.quantity === listLots(c.id).reduce((n, l) => n + l.remaining, 0))).toBe(true);
  });

  it("takes a card's purchases and sale records with it when it goes", () => {
    const card = createCard({ game: "pokemon", name: "Doomed", quantity: 2, purchasePrice: 10 });
    recordSale(card.id, { quantity: 1, unitPrice: 20 });
    const db = getDb();
    expect((db.prepare("SELECT COUNT(*) AS n FROM sale_lots").get() as { n: number }).n).toBe(1);
    db.prepare("DELETE FROM cards WHERE id = ?").run(card.id);
    expect((db.prepare("SELECT COUNT(*) AS n FROM acquisitions").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM sale_lots").get() as { n: number }).n).toBe(0);
  });
});

describe("collections that predate lots", () => {
  it("gives every existing card one purchase from what it already knew", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-backfill-"));
    const file = path.join(dir, "old.db");

    // Build a database in the shape it had before purchases were recorded
    // separately: cards carrying one price, and a card already sold down.
    const before = openDatabase(file);
    before.exec("DELETE FROM acquisitions");
    before.prepare("DELETE FROM settings WHERE key = 'acquisitions_backfilled'").run();
    const stamp = "2024-01-01T00:00:00.000Z";
    const insert = before.prepare(
      `INSERT INTO cards (id, game, name, quantity, condition, purchase_price, external_ids, manual_graded, grading_status, created_at, updated_at)
       VALUES (?, 'pokemon', ?, ?, 'NM', ?, '{}', '{}', 'undecided', ?, ?)`,
    );
    insert.run(1, "Priced", 2, 100, stamp, stamp);
    insert.run(2, "Unpriced", 1, null, stamp, stamp);
    insert.run(3, "All sold", 0, 50, stamp, stamp);
    before
      .prepare("INSERT INTO sales (card_id, quantity, unit_price, fees, unit_cost, sold_at, created_at) VALUES (3, 2, 80, 0, 50, ?, ?)")
      .run(stamp, stamp);
    before.close();

    setDb(openDatabase(file));
    expect(lots(1)).toEqual([{ quantity: 2, remaining: 2, unitCost: 100 }]);
    // Unknown, not free: a zero basis would report the card as pure profit.
    expect(lots(2)).toEqual([{ quantity: 1, remaining: 1, unitCost: null }]);
    // Sold down to nothing, but the lot still records what was once held.
    expect(lots(3)).toEqual([{ quantity: 2, remaining: 0, unitCost: 50 }]);
    expect(listLots(1)[0].acquiredAt).toBe(stamp);
    expect(verifyLotInvariant()).toEqual([]);

    // Reopening does not do it twice.
    getDb().close();
    setDb(openDatabase(file));
    expect(lots(1)).toHaveLength(1);

    getDb().close();
    setDb(undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
