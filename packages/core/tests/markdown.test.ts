import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseDocument, readTable } from "../src/markdown/format";
import { parseItemMarkdown } from "../src/domain/markdown/document";
import { widgetEngine, widgetSpec, type Widget } from "./widgets";

let engine: ReturnType<typeof widgetEngine>;
beforeEach(() => {
  engine = widgetEngine();
});

const spec = widgetSpec();

function fileFor(id: number): string {
  const dir = engine.mirror.itemsDir();
  const name = fs.readdirSync(dir).find((f) => f.startsWith(String(id).padStart(4, "0")))!;
  return fs.readFileSync(path.join(dir, name), "utf8");
}

describe("an item as a document", () => {
  it("writes every field by its snake-case key and reads it back", () => {
    const w = engine.repo.createItem({
      name: "Gizmo",
      maker: "Acme",
      kind: "gizmo",
      year: 1999,
      weight: 1.5,
      signed: true,
      boughtOn: "2026-01-02",
      tags: ["a", "b"],
      history: [{ date: "2026-01-01", note: "serviced" }],
      notes: "# not a heading\n--- not a fence",
      location: "Shelf 1",
      purchasePrice: 12,
    });
    const text = engine.mirror.render(w);
    const { data, body } = parseDocument(text);
    expect(data).toMatchObject({ name: "Gizmo", maker: "Acme", kind: "gizmo", year: 1999, weight: 1.5, signed: true, tags: ["a", "b"], location: "Shelf 1", purchase_price: 12 });
    expect(data.bought_on).toMatch(/^2026-01-02/);
    expect(body).toContain("# Gizmo");
    expect(body).toContain("Acme · gizmo · 1999");
    expect(body).toContain("## History");
    const parsed = parseItemMarkdown<Widget>(spec, text)!;
    expect(parsed.id).toBe(w.id);
    expect(parsed.input).toMatchObject({ name: "Gizmo", maker: "Acme", kind: "gizmo", year: 1999, weight: 1.5, signed: true, tags: ["a", "b"], notes: "# not a heading\n--- not a fence" });
    expect(parsed.input.history).toEqual([{ date: "2026-01-01", note: "serviced" }]);
    expect(parsed.acquisitions).toMatchObject([{ quantity: 1, remaining: 1, unitCost: 12 }]);
  });

  it("keeps a private field out of the file unless the owner opts in", () => {
    const w = engine.repo.createItem({ name: "Gizmo", serial: "SECRET-1" });
    expect(engine.mirror.render(w)).not.toContain("SECRET-1");
    engine.settings.saveSettings({ exportPrivateFields: true });
    expect(engine.mirror.render(w)).toContain("SECRET-1");
    expect(engine.exportCsv()).toContain("SECRET-1");
    engine.settings.saveSettings({ exportPrivateFields: false });
    expect(engine.exportCsv()).not.toContain("SECRET-1");
  });

  it("leaves a false flag out and reads a missing one as no", () => {
    const w = engine.repo.createItem({ name: "Gizmo" });
    const text = engine.mirror.render(w);
    expect(parseDocument(text).data.signed).toBeUndefined();
    expect(parseItemMarkdown<Widget>(spec, text)!.input.signed).toBe(false);
  });

  it("is not fooled by prose that merely has a title", () => {
    expect(parseItemMarkdown(spec, "# Your widgets\n\nThis folder is a copy.\n")).toBeNull();
  });

  it("records values, purchases and sales as tables", () => {
    const w = engine.repo.createItem({ name: "Gizmo", quantity: 2, purchasePrice: 1 });
    engine.repo.addSnapshot(w.id, { currency: "USD", fetchedAt: "2026-06-01T00:00:00.000Z", yourCopyValue: 9, yourCopyBasis: "Fake", quotes: [], errors: [], market: 9, marketSource: "Fake" });
    engine.sales.recordSale(w.id, { quantity: 1, unitPrice: 10, venue: "eBay" });
    const text = fileFor(w.id);
    expect(readTable(text, "Value history")[0].slice(0, 3)).toEqual(["2026-06-01T00:00:00.000Z", "$9.00", "Fake"]);
    expect(readTable(text, "Value history")[0][3]).toBe("Fake: 9");
    expect(readTable(text, "Sales")[0][5]).toBe("eBay");
    expect(readTable(text, "Sales")[0][7]).toContain("1 @ $1.00");
  });
});

describe("reading a file somebody edited", () => {
  it("skips a sale whose date is not one, the way it already skips a purchase", () => {
    const w = engine.repo.createItem({ name: "Gizmo", maker: "Acme", quantity: 2, purchasePrice: 10 });
    engine.sales.recordSale(w.id, { quantity: 1, unitPrice: 25, fees: 1, venue: "eBay" });
    engine.mirror.flushCollection();
    const text = fileFor(w.id);
    expect(parseItemMarkdown<Widget>(spec, text)!.sales).toHaveLength(1);

    // The same file with the sale's date replaced by something that is not one.
    const [head, sales] = text.split("## Sales");
    const broken = `${head}## Sales${sales.replace(/\| \d{4}-\d{2}-\d{2}[^|]*\|/, "| whenever |")}`;
    const parsed = parseItemMarkdown<Widget>(spec, broken)!;
    expect(parsed.sales).toEqual([]);
    expect(parsed.warnings.join(" ")).toMatch(/unreadable sale row/);
  });
});

describe("the folder on disk", () => {
  it("writes a file per item and an index that links to them", () => {
    const w = engine.repo.createItem({ name: "Gizmo", maker: "Acme" });
    engine.repo.createItem({ name: "Gadget", quantity: 3 });
    engine.mirror.flushCollection();
    const files = fs.readdirSync(engine.mirror.itemsDir()).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(2);
    const index = fs.readFileSync(path.join(engine.mirror.collectionDir(), "index.md"), "utf8");
    expect(index).toContain(`widgets/${String(w.id).padStart(4, "0")}-gizmo.md`);
    expect(index).toContain("| Maker |");
    expect(index).toContain("2 widgets, 4 copies");
    expect(fs.existsSync(path.join(engine.mirror.collectionDir(), "README.md"))).toBe(true);
  });

  it("takes the old file with it when an item is renamed", () => {
    const w = engine.repo.createItem({ name: "Gizmo" });
    engine.repo.updateItem(w.id, { name: "Gizmo Deluxe" });
    const after = fs.readdirSync(engine.mirror.itemsDir()).filter((f) => f.endsWith(".md"));
    expect(after).toEqual([`${String(w.id).padStart(4, "0")}-gizmo-deluxe.md`]);
  });

  it("leaves alone a file describing an item this database never had", () => {
    engine.repo.createItem({ name: "Gizmo" });
    engine.mirror.flushCollection();
    fs.writeFileSync(path.join(engine.mirror.itemsDir(), "9999-someone-elses.md"), ["---", "id: 9999", 'name: "Other"', "quantity: 1", "---", "", "# Other", ""].join("\n"));
    const result = engine.mirror.rebuildCollection(engine.repo.listItems());
    expect(result.orphans).toBe(1);
    expect(fs.existsSync(path.join(engine.mirror.itemsDir(), "9999-someone-elses.md"))).toBe(true);
  });
});

describe("rebuilding from nothing but the files", () => {
  it("brings back the items, the lots, the sales and the values", () => {
    engine.settings.saveSettings({ exportPrivateFields: true });
    const a = engine.repo.createItem({ name: "Gizmo", maker: "Acme", kind: "gizmo", serial: "S1", purchasePrice: 900, tags: ["x"] });
    const b = engine.repo.createItem({ name: "Gadget", quantity: 2, purchasePrice: 1 });
    engine.repo.addAcquisition(b.id, { quantity: 3, unitCost: 4 });
    engine.sales.recordSale(b.id, { quantity: 3, unitPrice: 10 });
    engine.repo.addSnapshot(a.id, { currency: "USD", fetchedAt: "2026-01-01T00:00:00.000Z", yourCopyValue: 950, yourCopyBasis: "Fake", quotes: [], errors: [], market: 950, marketSource: "Fake" });
    engine.repo.addSnapshot(a.id, { currency: "USD", fetchedAt: "2026-03-01T00:00:00.000Z", yourCopyValue: 990, yourCopyBasis: "Fake", quotes: [], errors: [], market: 990, marketSource: "Fake" });
    engine.mirror.flushCollection();
    const files = engine.mirror.readItemFiles();
    expect(files).toHaveLength(2);

    engine.db.setDb(engine.db.openDatabase(":memory:"));
    expect(engine.repo.listItems()).toHaveLength(0);
    const result = engine.restore.importItemFiles(files);
    expect(result).toMatchObject({ created: 2, skipped: [] });

    const back = engine.repo.getItem(a.id)!;
    expect(back).toMatchObject({ name: "Gizmo", maker: "Acme", kind: "gizmo", serial: "S1", purchasePrice: 900, tags: ["x"] });
    expect(engine.repo.latestSnapshot(a.id)!.summary.yourCopyValue).toBe(990);
    expect(engine.repo.listSnapshots(a.id)).toHaveLength(2);

    const restored = engine.repo.getItem(b.id)!;
    expect(restored.quantity).toBe(2);
    expect(engine.ledger.listLots(restored.id).map((l) => [l.unitCost, l.quantity, l.remaining])).toEqual([
      [1, 2, 0],
      [4, 3, 2],
    ]);
    const sale = engine.sales.listSalesForItem(restored.id)[0];
    expect(engine.ledger.listSaleLots(sale.id).map((l) => [l.quantity, l.unitCost])).toEqual([
      [2, 1],
      [1, 4],
    ]);
    expect(engine.ledger.verifyLotInvariant()).toEqual([]);

    // Reading the same folder twice changes nothing.
    const again = engine.restore.importItemFiles(files);
    expect(again).toMatchObject({ created: 0, replaced: 2 });
    expect(engine.repo.listItems()).toHaveLength(2);
  });

  it("does not fold two unique objects of the same name into one", () => {
    engine.settings.saveSettings({ exportPrivateFields: true });
    engine.repo.createItem({ name: "Gizmo", serial: "S1" });
    engine.repo.createItem({ name: "Gizmo", serial: "S2" });
    engine.mirror.flushCollection();
    const files = engine.mirror.readItemFiles();
    engine.db.setDb(engine.db.openDatabase(":memory:"));
    engine.restore.importItemFiles(files);
    expect(engine.repo.listItems().map((i) => i.serial).sort()).toEqual(["S1", "S2"]);
  });

  it("reports a file that the normaliser refuses instead of failing the import", () => {
    const bad = ["---", "id: 5", 'name: "Odd"', 'kind: "spaceship"', "quantity: 1", "---", "", "# Odd", ""].join("\n");
    const result = engine.restore.importItemFiles([{ name: "0005-odd.md", text: bad }]);
    expect(result.created).toBe(0);
    expect(result.skipped[0].reason).toMatch(/Unknown kind/);
  });
});
