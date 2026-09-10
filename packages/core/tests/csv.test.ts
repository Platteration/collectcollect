import { beforeEach, describe, expect, it } from "vitest";
import { widgetEngine } from "./widgets";

let engine: ReturnType<typeof widgetEngine>;
beforeEach(() => {
  engine = widgetEngine();
});

const csv = (...lines: string[]) => lines.join("\n");

describe("importing a spreadsheet", () => {
  it("maps columns by key, label, alias and base names, and says what it ignored", () => {
    const preview = engine.csv.previewImport(csv("Name,Brand,Kind,Qty,Price Paid,Mystery", "Gizmo,Acme,thingy,2,$12.50,x"));
    expect(preview.mapping).toMatchObject({ name: "Name", maker: "Brand", kind: "Kind", quantity: "Qty", purchasePrice: "Price Paid" });
    expect(preview.unmapped).toEqual(["Mystery"]);
    expect(preview.rows[0].input).toMatchObject({ name: "Gizmo", maker: "Acme", kind: "gizmo", quantity: 2, purchasePrice: 12.5 });
  });

  it("reports rows it cannot use by line, and warns about what it assumed", () => {
    const preview = engine.csv.previewImport(csv("name,kind,year", "Gizmo,gadget,1999", ",gizmo,2000", "Odd,ufo,1990", "Old,gizmo,12"));
    expect(preview.rows.map((r) => r.line)).toEqual([2, 3, 4, 5]);
    expect(preview.rows[1].problem).toMatch(/No widget name/);
    expect(preview.rows[2].warning).toMatch(/not recognised/);
    expect(preview.rows[3].problem).toMatch(/at least 1800/);
    expect(preview.usable).toBe(2);
  });

  it("creates what is new and joins stacks already held", () => {
    engine.csv.applyImport(engine.csv.previewImport(csv("name,maker,qty,cost", "Gadget,Acme,10,0.42")));
    const result = engine.csv.applyImport(engine.csv.previewImport(csv("name,maker,qty,cost", "Gadget,Acme,5,1.15", "Other,Acme,2,0.30")));
    expect(result).toMatchObject({ created: 1, merged: 1, skipped: [] });
    const gadget = engine.repo.listItems().find((i) => i.name === "Gadget")!;
    expect(gadget.quantity).toBe(15);
    expect(engine.ledger.listLots(gadget.id).map((l) => l.unitCost)).toEqual([0.42, 1.15]);
  });
});

describe("exporting", () => {
  it("writes the columns the importer reads back, with enum labels and yes for flags", () => {
    engine.repo.createItem({ name: "Gizmo", kind: "gizmo", signed: true, tags: ["a", "b"], quantity: 2, purchasePrice: 3, location: "Shelf" });
    const text = engine.exportCsv();
    const [header, row] = text.trim().split("\r\n");
    expect(header.split(",")).toEqual(["id", "name", "maker", "kind", "year", "weight", "signed", "bought_on", "tags", "history", "quantity", "cost", "location", "value_each", "value_total", "basis", "price_date", "notes"]);
    expect(row).toContain("Gizmo,,Gizmo,,,yes,,a; b,,2,3,Shelf");
    // and it reads straight back in
    const preview = engine.csv.previewImport(text);
    expect(preview.rows[0].input).toMatchObject({ name: "Gizmo", kind: "gizmo", signed: true, tags: ["a", "b"], quantity: 2, purchasePrice: 3 });
  });

  it("neutralises a cell that would run as a formula", () => {
    engine.repo.createItem({ name: "=HYPERLINK(\"x\")" });
    expect(engine.exportCsv()).toContain("'=HYPERLINK");
  });
});
