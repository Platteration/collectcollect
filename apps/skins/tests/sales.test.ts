import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { addAcquisition, getItem, updateItem } from "@/lib/items";
import { listLots, listSaleLots, verifyLotInvariant } from "@/lib/acquisitions";
import { deleteSale, listSales, listSalesForItem, recordSale } from "@/lib/sales";
import { realizedReturn } from "@/lib/analytics";
import { seedCase, seedRedline } from "./helpers";

beforeEach(() => setDb(openDatabase(":memory:")));

describe("recording a sale", () => {
  it("takes the copies and books the gain", () => {
    const item = seedCase({ quantity: 3, purchasePrice: 1 });
    const sale = recordSale(item.id, { quantity: 2, unitPrice: 5, fees: 0.6 });
    expect(sale.unitCost).toBe(1);
    expect(getItem(item.id)!.quantity).toBe(1);
    expect(verifyLotInvariant()).toEqual([]);
    expect(realizedReturn([sale]).gain).toBeCloseTo(2 * 5 - 0.6 - 2 * 1, 10);
  });

  it("sells the oldest copies first, at what those copies cost", () => {
    const item = seedCase({ quantity: 1, purchasePrice: 1 });
    addAcquisition(item.id, { quantity: 1, unitCost: 9 });
    const sale = recordSale(item.id, { quantity: 1, unitPrice: 10 });
    // The dollar copy went, not the nine-dollar one.
    expect(sale.unitCost).toBe(1);
    expect(listLots(item.id).map((l) => l.remaining)).toEqual([0, 1]);
  });

  it("says which purchase each sold copy came out of", () => {
    const item = seedCase({ quantity: 2, purchasePrice: 1 });
    addAcquisition(item.id, { quantity: 2, unitCost: 4 });
    const sale = recordSale(item.id, { quantity: 3, unitPrice: 10 });
    expect(listSaleLots(sale.id)).toEqual([
      { acquisitionId: listLots(item.id)[0]?.id, quantity: 2, unitCost: 1 },
      { acquisitionId: listLots(item.id)[1]?.id, quantity: 1, unitCost: 4 },
    ]);
  });

  it("has no cost for a sale that took a copy nobody priced", () => {
    const item = seedCase({ quantity: 2 });
    // Blending a known cost with an unknown one would understate what the sale
    // cost while looking like a complete answer.
    expect(recordSale(item.id, { quantity: 1, unitPrice: 3 }).unitCost).toBeNull();
  });

  it("refuses a price that is not a number instead of booking a free sale", () => {
    const item = seedCase({ quantity: 1, purchasePrice: 1 });
    // JSON turns NaN into null on the way in, and Number(null) is 0.
    expect(() => recordSale(item.id, { unitPrice: null as never })).toThrow(/price is required/i);
    expect(() => recordSale(item.id, { unitPrice: "abc" as never })).toThrow(/must be a number/i);
    expect(getItem(item.id)!.quantity).toBe(1);
  });

  it("allows a deliberate zero", () => {
    const item = seedCase({ quantity: 1, purchasePrice: 1 });
    expect(recordSale(item.id, { unitPrice: 0 }).unitPrice).toBe(0);
  });

  it("will not sell more copies than are held", () => {
    const item = seedCase({ quantity: 1 });
    expect(() => recordSale(item.id, { quantity: 2, unitPrice: 1 })).toThrow(/only have 1/i);
  });

  it("sells a unique item exactly once", () => {
    const item = seedRedline({ purchasePrice: 40 });
    recordSale(item.id, { quantity: 1, unitPrice: 65, fees: 8 });
    expect(getItem(item.id)!.quantity).toBe(0);
    // The row stays so the history and the cost survive the sale.
    expect(getItem(item.id)!.purchasePrice).toBe(40);
    expect(() => recordSale(item.id, { quantity: 1, unitPrice: 1 })).toThrow();
  });
});

describe("undoing a sale", () => {
  it("puts the copies back in the lots they came from", () => {
    const item = seedCase({ quantity: 2, purchasePrice: 1 });
    addAcquisition(item.id, { quantity: 2, unitCost: 4 });
    const sale = recordSale(item.id, { quantity: 3, unitPrice: 10 });
    expect(deleteSale(sale.id)).toBe(true);
    expect(getItem(item.id)!.quantity).toBe(4);
    expect(listLots(item.id).map((l) => [l.unitCost, l.remaining])).toEqual([
      [1, 2],
      [4, 2],
    ]);
    expect(verifyLotInvariant()).toEqual([]);
  });

  it("does not invent a cost for the copies it returns", () => {
    const item = seedCase({ quantity: 1, purchasePrice: 7 });
    const sale = recordSale(item.id, { quantity: 1, unitPrice: 10 });
    deleteSale(sale.id);
    expect(getItem(item.id)!.purchasePrice).toBe(7);
  });

  it("leaves nothing behind in the ledger", () => {
    const item = seedCase({ quantity: 1, purchasePrice: 1 });
    const sale = recordSale(item.id, { quantity: 1, unitPrice: 5 });
    deleteSale(sale.id);
    expect(listSalesForItem(item.id)).toEqual([]);
    expect(listSaleLots(sale.id)).toEqual([]);
  });
});

describe("the sales ledger", () => {
  it("describes each sold item by what makes it that item", () => {
    const item = seedRedline({ purchasePrice: 40, nameTag: "old faithful" });
    recordSale(item.id, { quantity: 1, unitPrice: 65 });
    const [row] = listSales();
    expect(row?.itemName).toBe("AK-47 | Redline (Field-Tested)");
    expect(row?.itemDetail).toContain("Field-Tested");
    expect(row?.itemDetail).toContain("float 0.22");
    expect(row?.itemDetail).toContain("old faithful");
  });
});

describe("a correction is not a sale", () => {
  it("takes an unexplained reduction off the newest purchase", () => {
    const item = seedCase({ quantity: 1, purchasePrice: 1 });
    addAcquisition(item.id, { quantity: 1, unitCost: 9 });
    // Typing "1" into the count is most likely undoing the purchase just made,
    // not selling the oldest copy; taking it off the oldest would leave the
    // remaining copy priced at $9 when it is the $1 one.
    updateItem(item.id, { quantity: 1 });
    expect(listLots(item.id).map((l) => [l.unitCost, l.remaining])).toEqual([[1, 1]]);
    expect(getItem(item.id)!.purchasePrice).toBe(1);
    expect(verifyLotInvariant()).toEqual([]);
  });
});
