import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { createCard, getCard } from "@/lib/cards";
import { deleteSale, listSales, listSalesForCard, recordSale } from "@/lib/sales";
import { realizedReturn } from "@/lib/analytics";

describe("sales", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("records a sale, removes the copies, and captures the cost basis", () => {
    const card = createCard({ game: "pokemon", name: "Charizard", quantity: 3, purchasePrice: 100 });
    const sale = recordSale(card.id, { quantity: 2, unitPrice: 250, fees: 30, venue: "eBay" });
    expect(sale).toMatchObject({ quantity: 2, unitPrice: 250, fees: 30, unitCost: 100, venue: "eBay" });
    expect(getCard(card.id)?.quantity).toBe(1);
    expect(listSalesForCard(card.id)).toHaveLength(1);
  });

  it("keeps the recorded cost even if the card's purchase price is edited later", async () => {
    const card = createCard({ game: "mtg", name: "Lotus", purchasePrice: 50 });
    recordSale(card.id, { unitPrice: 90 });
    const { updateCard } = await import("@/lib/cards");
    updateCard(card.id, { purchasePrice: 999 });
    expect(listSalesForCard(card.id)[0].unitCost).toBe(50);
  });

  it("refuses to sell more copies than are owned, or nonsense numbers", () => {
    const card = createCard({ game: "yugioh", name: "Kuriboh", quantity: 1 });
    expect(() => recordSale(card.id, { quantity: 2, unitPrice: 5 })).toThrow(/only have 1/);
    expect(() => recordSale(card.id, { quantity: 0, unitPrice: 5 })).toThrow(/at least one/);
    expect(() => recordSale(card.id, { unitPrice: Number.NaN })).toThrow(/must be a number/);
    expect(() => recordSale(card.id, { unitPrice: 5, fees: -1 })).toThrow(/Fees/);
    expect(() => recordSale(card.id, { unitPrice: 5, soldAt: "not a date" })).toThrow(/valid date/);
    expect(() => recordSale(999, { unitPrice: 5 })).toThrow(/not found/);
  });

  it("undoes a sale by putting the copies back", () => {
    const card = createCard({ game: "sports", name: "Trout", quantity: 2 });
    const sale = recordSale(card.id, { quantity: 2, unitPrice: 400 });
    expect(getCard(card.id)?.quantity).toBe(0);
    expect(deleteSale(sale.id)).toBe(true);
    expect(getCard(card.id)?.quantity).toBe(2);
    expect(deleteSale(sale.id)).toBe(false);
  });

  it("lists sales across cards with their details", () => {
    const a = createCard({ game: "pokemon", name: "Pikachu", setName: "Jungle", cardNumber: "60/64", year: 1999 });
    recordSale(a.id, { unitPrice: 40 });
    const rows = listSales();
    expect(rows[0]).toMatchObject({ cardName: "Pikachu", game: "pokemon" });
    expect(rows[0].cardDetail).toBe("Jungle · #60/64 · 1999");
  });

  it("sums realized gains, netting fees and cost", () => {
    const r = realizedReturn([
      { quantity: 2, unitPrice: 250, fees: 30, unitCost: 100 },
      { quantity: 1, unitPrice: 90, fees: 10, unitCost: null },
    ]);
    expect(r).toMatchObject({ proceeds: 590, fees: 40, cost: 200, gain: 350, sales: 2, copies: 3, withoutCost: 1 });
    expect(r.percent).toBe(175);
    expect(realizedReturn([]).percent).toBeNull();
  });
});
