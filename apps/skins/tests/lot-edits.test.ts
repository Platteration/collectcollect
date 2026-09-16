import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { addAcquisition, createItem, getItem, updateItem } from "@/lib/items";
import { listLots, listSaleLots, verifyLotInvariant } from "@/lib/acquisitions";
import { correctLot } from "@/lib/lot-edits";
import { deleteSale, listSalesForItem, recordSale } from "@/lib/sales";
const create = () => createItem({ marketHashName: "Clutch Case", category: "case", quantity: 2, purchasePrice: 10 });
const read = getItem;
beforeEach(() => setDb(openDatabase(":memory:")));
describe("purchase corrections", () => {
  it("corrects one of several lots without changing counts or another cost", () => {
    const entity = create();
    addAcquisition(entity.id, { quantity: 1, unitCost: null });
    const lot = listLots(entity.id)[1]!;
    correctLot(entity.id, lot.id, { expected: lot, unitCost: 0, source: "Gift" });
    expect(read(entity.id)?.quantity).toBe(3);
    expect(listLots(entity.id).map((l) => l.unitCost)).toEqual([10, 0]);
    expect(read(entity.id)?.purchasePrice).toBeCloseTo(20 / 3, 2);
    expect(verifyLotInvariant()).toEqual([]);
  });
  it("refuses wrong parent, stale edits and invalid costs", () => {
    const entity = create(), lot = listLots(entity.id)[0]!;
    expect(() => correctLot(entity.id + 1, lot.id, { expected: lot, unitCost: 2 })).toThrow(/not found/);
    expect(() => correctLot(entity.id, lot.id, { expected: lot, unitCost: -1 })).toThrow(/Cost/);
    correctLot(entity.id, lot.id, { expected: lot, unitCost: null });
    expect(() => correctLot(entity.id, lot.id, { expected: lot, unitCost: 3 })).toThrow(/changed/);
  });
  it("freezes sold costs and dates, including the general edit route", () => {
    const entity = create(), original = listLots(entity.id)[0]!;
    const sale = recordSale(entity.id, { quantity: 1, unitPrice: 25 });
    const sold = listLots(entity.id)[0]!;
    expect(() => correctLot(entity.id, sold.id, { expected: original, unitCost: 9 })).toThrow(/changed/);
    expect(() => correctLot(entity.id, sold.id, { expected: sold, unitCost: 9 })).toThrow(/sold/);
    expect(() => correctLot(entity.id, sold.id, { expected: sold, acquiredAt: "2020-01-01T00:00:00.000Z" })).toThrow(/sold/);
    expect(() => updateItem(entity.id, { purchasePrice: 9 })).toThrow(/sold/);
    correctLot(entity.id, sold.id, { expected: sold, source: "Receipt located" });
    expect(listSaleLots(sale.id)[0]?.unitCost).toBe(10);
    expect(listSalesForItem(entity.id)[0]?.unitCost).toBe(10);
    deleteSale(sale.id);
    const restored = listLots(entity.id)[0]!;
    correctLot(entity.id, restored.id, { expected: restored, unitCost: 9 });
    expect(read(entity.id)?.purchasePrice).toBe(9);
    expect(verifyLotInvariant()).toEqual([]);
  });
});
