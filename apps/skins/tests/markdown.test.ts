import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { addAcquisition, getItem, latestSnapshot, listItems, updateItem } from "@/lib/items";
import { listLots, listSaleLots, verifyLotInvariant } from "@/lib/acquisitions";
import { listSalesForItem, recordSale } from "@/lib/sales";
import { itemFileName, itemMarkdown, parseItemMarkdown } from "@/lib/markdown/item";
import { collectionDir, flushCollection, itemsDir, mirrorEnabled, readItemFiles, rebuildCollection } from "@/lib/markdown/mirror";
import { importFromDisk, importItemFiles } from "@/lib/markdown/restore";
import { parseDocument, readTable } from "@collectcollect/core/markdown/format";
import { seedCase, seedRedline } from "./helpers";

beforeEach(() => setDb(openDatabase(":memory:")));

function fileFor(id: number): string {
  const name = fs.readdirSync(itemsDir()).find((f) => f.startsWith(String(id).padStart(4, "0")))!;
  return fs.readFileSync(path.join(itemsDir(), name), "utf8");
}

describe("an item as a document", () => {
  it("writes the facts a person needs and the facts a program needs", () => {
    const item = seedRedline({ purchasePrice: 42, storageUnit: "Storage Unit 1", nameTag: "old faithful" });
    const text = itemMarkdown({ item, sales: [], snapshots: [], acquisitions: listLots(item.id) });
    const { data, body } = parseDocument(text);
    expect(data.market_hash_name).toBe("AK-47 | Redline (Field-Tested)");
    expect(data.float).toBe(0.22);
    expect(data.paint_seed).toBe(412);
    expect(data.exterior).toBe("field_tested");
    expect(body).toContain("# AK-47 | Redline (Field-Tested)");
    expect(body).toContain("float 0.22");
    expect(body).toContain("pattern 412");
    expect(body).toContain("old faithful");
    expect(body).toContain("Field-Tested");
  });

  it("leaves StatTrak out when it is not StatTrak, and says so when it is", () => {
    const plain = seedRedline();
    const st = seedRedline({ marketHashName: "StatTrak™ AK-47 | Redline (Field-Tested)", stattrak: true, floatValue: 0.3 });
    const noFlag = parseDocument(itemMarkdown({ item: plain, sales: [], snapshots: [], acquisitions: [] })).data;
    const flagged = parseDocument(itemMarkdown({ item: st, sales: [], snapshots: [], acquisitions: [] })).data;
    expect(noFlag.stattrak).toBeUndefined();
    expect(flagged.stattrak).toBe(true);
    expect(parseItemMarkdown(itemMarkdown({ item: plain, sales: [], snapshots: [], acquisitions: [] }))!.input.stattrak).toBe(false);
  });

  it("comes back out the way it went in", () => {
    const item = seedRedline({
      purchasePrice: 42,
      notes: "bought after a bad night",
      stickers: [
        { slot: 0, name: "iBUYPOWER | Katowice 2014", marketHashName: "Sticker | iBUYPOWER | Katowice 2014", wear: 0 },
        { slot: 1, name: "Titan | Katowice 2014", marketHashName: null, wear: 0.35 },
      ],
    });
    const parsed = parseItemMarkdown(itemMarkdown({ item, sales: [], snapshots: [], acquisitions: listLots(item.id) }))!;
    expect(parsed.id).toBe(item.id);
    expect(parsed.input.marketHashName).toBe(item.marketHashName);
    expect(parsed.input.floatValue).toBe(0.22);
    expect(parsed.input.paintSeed).toBe(412);
    expect(parsed.input.rarity).toBe("classified");
    expect(parsed.input.notes).toBe("bought after a bad night");
    expect(parsed.input.stickers).toEqual(item.stickers);
  });

  it("does not lose float precision on the way through", () => {
    const value = 0.1234567891;
    const item = seedRedline({ floatValue: value });
    const parsed = parseItemMarkdown(itemMarkdown({ item, sales: [], snapshots: [], acquisitions: [] }))!;
    expect(parsed.input.floatValue).toBe(value);
  });

  it("is not fooled by prose that merely has a title", () => {
    expect(parseItemMarkdown("# Your inventory, in plain text\n\nThis folder is a copy.\n")).toBeNull();
  });

  it("keeps a note that starts with a hash out of the section structure", () => {
    const item = seedRedline({ notes: "# not a heading\n--- not a fence" });
    const parsed = parseItemMarkdown(itemMarkdown({ item, sales: [], snapshots: [], acquisitions: [] }))!;
    expect(parsed.input.notes).toBe("# not a heading\n--- not a fence");
  });

  it("keeps a name tag holding a pipe out of the table structure", () => {
    const item = seedRedline({ nameTag: "a | b" });
    const text = itemMarkdown({ item, sales: [], snapshots: [], acquisitions: listLots(item.id) });
    expect(parseItemMarkdown(text)!.input.nameTag).toBe("a | b");
  });

  it("distinguishes a copy that cost nothing from one nobody priced", () => {
    const free = seedCase({ quantity: 1, purchasePrice: 0 });
    const unknown = seedCase({ marketHashName: "Chroma Case", quantity: 1 });
    const freeRow = readTable(itemMarkdown({ item: free, sales: [], snapshots: [], acquisitions: listLots(free.id) }), "Acquisitions")[0];
    const unknownRow = readTable(
      itemMarkdown({ item: unknown, sales: [], snapshots: [], acquisitions: listLots(unknown.id) }),
      "Acquisitions",
    )[0];
    expect(freeRow[3]).toBe("$0.00");
    expect(unknownRow[3]).toBe("");
    expect(parseItemMarkdown(itemMarkdown({ item: free, sales: [], snapshots: [], acquisitions: listLots(free.id) }))!.acquisitions[0].unitCost).toBe(0);
    expect(
      parseItemMarkdown(itemMarkdown({ item: unknown, sales: [], snapshots: [], acquisitions: listLots(unknown.id) }))!.acquisitions[0]
        .unitCost,
    ).toBeNull();
  });

  it("reads a file with no purchase table as one lot rather than none", () => {
    const text = ["---", 'market_hash_name: "Clutch Case"', 'category: "case"', "quantity: 4", "purchase_price: 0.75", "---", "", "# Clutch Case", ""].join("\n");
    const parsed = parseItemMarkdown(text)!;
    expect(parsed.acquisitions).toEqual([
      expect.objectContaining({ quantity: 4, remaining: 4, unitCost: 0.75 }),
    ]);
  });

  it("warns rather than throws when a row is mangled", () => {
    const text = [
      "---",
      'market_hash_name: "Clutch Case"',
      'category: "case"',
      "quantity: 1",
      "---",
      "",
      "# Clutch Case",
      "",
      "## Sales",
      "",
      "| Sold | Copies | Each | Fees | Cost each | Venue | Notes | Lots |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| | not a number | | | | | | |",
      "",
    ].join("\n");
    const parsed = parseItemMarkdown(text)!;
    expect(parsed.sales).toEqual([]);
    expect(parsed.warnings.join(" ")).toMatch(/unreadable sale row/i);
  });
});

describe("the folder on disk", () => {
  it("writes a file per item and an index that links to them", () => {
    const item = seedRedline({ purchasePrice: 42 });
    seedCase({ quantity: 6 });
    flushCollection();
    const files = fs.readdirSync(itemsDir()).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(2);
    expect(files).toContain(itemFileName(item));
    const index = fs.readFileSync(path.join(collectionDir(), "index.md"), "utf8");
    expect(index).toContain(`items/${itemFileName(item)}`);
    expect(index).toContain("2 items");
    expect(fs.existsSync(path.join(collectionDir(), "README.md"))).toBe(true);
  });

  it("takes the old file with it when an item is renamed", () => {
    const item = seedRedline();
    const before = itemFileName(item);
    updateItem(item.id, { marketHashName: "AK-47 | Redline (Minimal Wear)" });
    const after = fs.readdirSync(itemsDir());
    expect(after).not.toContain(before);
    expect(after).toHaveLength(1);
  });

  it("records the sale and which copies it took", () => {
    const item = seedCase({ quantity: 2, purchasePrice: 1 });
    addAcquisition(item.id, { quantity: 2, unitCost: 4 });
    recordSale(item.id, { quantity: 3, unitPrice: 10, venue: "Skinport" });
    const text = fileFor(item.id);
    const [row] = readTable(text, "Sales");
    expect(row[1]).toBe("3");
    expect(row[5]).toBe("Skinport");
    // The provenance column: two dollar copies and one four-dollar copy.
    expect(row[7]).toContain("2 @ $1.00");
    expect(row[7]).toContain("1 @ $4.00");
  });
});

describe("rebuilding an inventory from nothing but its files", () => {
  it("brings back the items, the floats, the stickers, the lots and the sales", () => {
    const knife = seedRedline({
      marketHashName: "★ Karambit | Doppler (Factory New)",
      category: "knife",
      rarity: "extraordinary",
      floatValue: 0.014,
      paintSeed: 387,
      purchasePrice: 900,
      stickers: [],
    });
    const rifle = seedRedline({
      purchasePrice: 42,
      notes: "first one",
      stickers: [{ slot: 0, name: "Crown (Foil)", marketHashName: "Sticker | Crown (Foil)", wear: 0.1 }],
    });
    const cases = seedCase({ quantity: 2, purchasePrice: 1 });
    addAcquisition(cases.id, { quantity: 3, unitCost: 4 });
    recordSale(cases.id, { quantity: 3, unitPrice: 10, venue: "Steam" });
    flushCollection();

    const files = readItemFiles();
    expect(files.length).toBe(3);

    // Everything the database knew is gone; the folder is all that is left.
    setDb(openDatabase(":memory:"));
    expect(listItems()).toHaveLength(0);
    const result = importItemFiles(files);
    expect(result.created).toBe(3);
    expect(result.skipped).toEqual([]);

    const back = getItem(knife.id)!;
    expect(back.marketHashName).toBe("★ Karambit | Doppler (Factory New)");
    expect(back.floatValue).toBe(0.014);
    expect(back.paintSeed).toBe(387);
    expect(back.exterior).toBe("factory_new");
    expect(back.rarity).toBe("extraordinary");
    expect(back.purchasePrice).toBe(900);

    expect(getItem(rifle.id)!.stickers).toEqual(rifle.stickers);
    expect(getItem(rifle.id)!.notes).toBe("first one");

    const restoredCases = getItem(cases.id)!;
    expect(restoredCases.quantity).toBe(2);
    expect(listLots(restoredCases.id).map((l) => [l.unitCost, l.quantity, l.remaining])).toEqual([
      [1, 2, 0],
      [4, 3, 2],
    ]);
    // The sale still knows which copies it took, so undoing it would return
    // them to the right lots rather than to a reconstruction.
    const sale = importedSale(restoredCases.id);
    expect(listSaleLots(sale).map((l) => [l.quantity, l.unitCost])).toEqual([
      [2, 1],
      [1, 4],
    ]);
    expect(verifyLotInvariant()).toEqual([]);
  });

  it("changes nothing the second time the same folder is read", () => {
    const item = seedRedline({ purchasePrice: 42 });
    seedCase({ quantity: 3, purchasePrice: 1 });
    flushCollection();
    const files = readItemFiles();
    setDb(openDatabase(":memory:"));
    importItemFiles(files);
    const after = importItemFiles(files);
    expect(after.created).toBe(0);
    expect(after.replaced).toBe(2);
    expect(listItems()).toHaveLength(2);
    expect(getItem(item.id)!.purchasePrice).toBe(42);
    expect(verifyLotInvariant()).toEqual([]);
  });

  it("does not fold two weapons of the same name into one", () => {
    seedRedline({ floatValue: 0.16, paintSeed: 1 });
    seedRedline({ floatValue: 0.37, paintSeed: 2 });
    flushCollection();
    const files = readItemFiles();
    setDb(openDatabase(":memory:"));
    importItemFiles(files);
    expect(listItems()).toHaveLength(2);
    expect(listItems().map((i) => i.floatValue).sort()).toEqual([0.16, 0.37]);
  });

  it("reads the folder this app maintains", () => {
    seedRedline({ purchasePrice: 42 });
    flushCollection();
    setDb(openDatabase(":memory:"));
    expect(importFromDisk().created).toBe(1);
  });

  it("gives the newest price back as the current one", () => {
    // Files list prices newest first for reading; putting them back in that
    // order would make the oldest the latest snapshot.
    const item = seedCase({ quantity: 1 });
    const text = [
      "---",
      `id: ${item.id}`,
      'market_hash_name: "Clutch Case"',
      'category: "case"',
      "quantity: 1",
      "---",
      "",
      "# Clutch Case",
      "",
      "## Value history",
      "",
      "| Date | Your copy | Market | Basis |",
      "| --- | --- | --- | --- |",
      "| 2026-03-01T00:00:00.000Z | $9.00 | $9.00 (Skinport) | Skinport |",
      "| 2026-01-01T00:00:00.000Z | $2.00 | $2.00 (Skinport) | Skinport |",
      "",
    ].join("\n");
    importItemFiles([{ name: "x.md", text }]);
    expect(latestSnapshot(item.id)!.summary.yourCopyValue).toBe(9);
  });
});

describe("switching the folder off", () => {
  it("answers to its own variable and not to the card app's", () => {
    const before = { own: process.env.SKINS_MARKDOWN_MIRROR, shared: process.env.MARKDOWN_MIRROR };
    try {
      // One .env file runs both apps. Turning the card app's copy off must not
      // quietly turn this one off with it.
      process.env.MARKDOWN_MIRROR = "off";
      delete process.env.SKINS_MARKDOWN_MIRROR;
      expect(mirrorEnabled()).toBe(true);
      process.env.SKINS_MARKDOWN_MIRROR = "off";
      expect(mirrorEnabled()).toBe(false);
      process.env.SKINS_MARKDOWN_MIRROR = "OFF";
      expect(mirrorEnabled()).toBe(false);
    } finally {
      if (before.own === undefined) delete process.env.SKINS_MARKDOWN_MIRROR;
      else process.env.SKINS_MARKDOWN_MIRROR = before.own;
      if (before.shared === undefined) delete process.env.MARKDOWN_MIRROR;
      else process.env.MARKDOWN_MIRROR = before.shared;
    }
  });
});

describe("rewriting the folder", () => {
  it("leaves alone a file describing an item this database never had", () => {
    seedRedline();
    flushCollection();
    // Somebody points a fresh install at the folder holding their only copy.
    fs.writeFileSync(
      path.join(itemsDir(), "9999-someone-elses-knife.md"),
      ["---", "id: 9999", 'market_hash_name: "★ Bayonet | Lore (Factory New)"', 'category: "knife"', "quantity: 1", "---", "", "# ★ Bayonet | Lore (Factory New)", ""].join("\n"),
    );
    const result = rebuildCollection(listItems());
    expect(result.orphans).toBe(1);
    expect(fs.existsSync(path.join(itemsDir(), "9999-someone-elses-knife.md"))).toBe(true);
  });

  it("clears half-written files left by a crash", () => {
    seedRedline();
    flushCollection();
    fs.writeFileSync(path.join(itemsDir(), "0001-half.md.tmp"), "---\n");
    rebuildCollection(listItems());
    expect(fs.readdirSync(itemsDir()).some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});

/** The id of the one sale an imported item has. */
function importedSale(itemId: number): number {
  return listSalesForItem(itemId)[0].id;
}
