import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { addSnapshot, createCard, deleteCard, listCards, listSnapshots, updateCard } from "@/lib/cards";
import { deleteSale, recordSale } from "@/lib/sales";
import { cardsDir, collectionDir, collectionStatus, flushCollection, readCardFiles, rebuildCollection } from "@/lib/markdown/mirror";
import { importCardFiles } from "@/lib/markdown/restore";
import { latestSnapshotsByCard } from "@/lib/cards";
import { parseCardMarkdown } from "@/lib/markdown/card";
import { parseDocument, readSection, readTable, writeFrontMatter } from "@/lib/markdown/format";
import type { PriceSummary } from "@/lib/types";

const summary = (value: number, at: string): PriceSummary => ({
  currency: "USD",
  fetchedAt: at,
  ungraded: value,
  ungradedSource: "PriceCharting",
  graded: { "PSA 10": value * 10, "PSA 9": value * 3 },
  gradedSource: "PriceCharting",
  estimatedGraded: {},
  yourCopyValue: value,
  yourCopyBasis: "Ungraded price, Near Mint.",
  quotes: [],
  errors: [],
});

function fileFor(id: number): string {
  const name = fs.readdirSync(cardsDir()).find((f) => f.startsWith(String(id).padStart(4, "0")));
  if (!name) throw new Error(`no file for card ${id}`);
  return fs.readFileSync(path.join(cardsDir(), name), "utf8");
}

describe("markdown encoding", () => {
  it("round-trips front matter through JSON values", () => {
    const text = writeFrontMatter({ name: "Chari|zard", year: 1999, external_ids: { pokemontcg: "base1-4" }, blank: null, empty: {} });
    const { data } = parseDocument(text);
    expect(data).toEqual({ name: "Chari|zard", year: 1999, external_ids: { pokemontcg: "base1-4" } });
  });

  it("reads front matter a person typed by hand", () => {
    const { data } = parseDocument(`---\nname: Charizard\nquantity: 3\nlocation: 'Binder 2'\nnotes:\n---\n\n# Charizard\n`);
    expect(data).toEqual({ name: "Charizard", quantity: 3, location: "Binder 2", notes: null });
  });

  it("keeps pipes and headings out of the structure", () => {
    const text = ["## Sales", "", "| A | B |", "| --- | --- |", "| one \\| two | 3 |", "", "## After", "", "later"].join("\n");
    expect(readTable(text, "Sales")).toEqual([["one | two", "3"]]);
    expect(readSection(text, "After")).toBe("later");
  });
});

describe("a card as a document", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("writes a file a person can read and the app can read back", () => {
    const card = createCard({
      game: "pokemon",
      name: "Charizard",
      setName: "Base Set",
      cardNumber: "4/102",
      year: 1999,
      quantity: 2,
      gradingCompany: "PSA",
      grade: "9",
      purchasePrice: 250,
      location: "Binder 2, page 4",
      notes: "Corner ding.\n\n# not a heading",
      externalIds: { pokemontcg: "base1-4" },
      manualGraded: { "PSA 10": 5000 },
    });
    addSnapshot(card.id, summary(300, "2026-01-02T10:00:00.000Z"));
    addSnapshot(card.id, summary(420, "2026-02-02T10:00:00.000Z"));
    recordSale(card.id, { quantity: 1, unitPrice: 500, fees: 40, venue: "eBay", soldAt: "2026-03-01T00:00:00.000Z" });

    const text = fileFor(card.id);
    expect(text).toContain("# Charizard");
    expect(text).toContain("Base Set");
    expect(text).toContain("Binder 2, page 4");
    expect(text).toContain("$500.00");

    const parsed = parseCardMarkdown(text)!;
    expect(parsed.id).toBe(card.id);
    expect(parsed.input).toMatchObject({
      name: "Charizard",
      setName: "Base Set",
      cardNumber: "4/102",
      year: 1999,
      quantity: 1,
      grade: "9",
      gradingCompany: "PSA",
      purchasePrice: 250,
      location: "Binder 2, page 4",
      externalIds: { pokemontcg: "base1-4" },
      manualGraded: { "PSA 10": 5000 },
    });
    expect(parsed.input.notes).toBe("Corner ding.\n\n# not a heading");
    expect(parsed.sales).toHaveLength(1);
    expect(parsed.sales[0]).toMatchObject({ quantity: 1, unitPrice: 500, fees: 40, venue: "eBay" });
    expect(parsed.snapshots).toHaveLength(2);
    expect(parsed.snapshots[0].summary).toMatchObject({ yourCopyValue: 420, ungraded: 420, graded: { "PSA 10": 4200, "PSA 9": 1260 } });
    expect(parsed.warnings).toEqual([]);
  });

  it("mirrors every column the cards table has", () => {
    const card = createCard({
      game: "sports",
      sport: "Baseball",
      name: "Ken Griffey Jr.",
      setName: "Upper Deck",
      setCode: "ud89",
      cardNumber: "1",
      year: 1989,
      rarity: "Rookie",
      variant: "Star",
      language: "English",
      manufacturer: "Upper Deck",
      quantity: 2,
      condition: "LP",
      gradingCompany: "PSA",
      grade: "8",
      certNumber: "1234",
      purchasePrice: 40,
      notes: "Off-centre.",
      imagePath: "11111111-1111-4111-8111-111111111111.jpg",
      referenceImageUrl: "https://example.com/a.jpg",
      accentColor: "#123456",
      location: "Box A",
      externalIds: { pricecharting: "42" },
      manualUngraded: 30,
      manualGraded: { "PSA 10": 900 },
      gradingStatus: "planned",
      identification: { name: "Ken Griffey Jr.", confidence: 0.9 } as never,
    });
    const text = fileFor(card.id);
    const front = parseDocument(text).data;
    // Written as prose rather than as a front matter field.
    const inBody: Record<string, boolean> = {
      notes: text.includes("Off-centre."),
      identification: text.includes("```json"),
    };
    const alias: Record<string, string> = { image_path: "photo" };
    const columns = (getDb().prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>).map((c) => c.name);
    const missing = columns.filter((column) => {
      if (column in inBody) return !inBody[column];
      const key = alias[column] ?? column;
      return !(key in front);
    });
    expect(missing).toEqual([]);
  });

  it("leaves one file behind even for a card whose name has nothing to slug", () => {
    // A name with no latin letters gives an empty slug, so the file is just
    // the id; renaming it must still take the old file with it.
    const card = createCard({ game: "pokemon", name: "リザードン" });
    expect(fs.readdirSync(cardsDir())).toEqual(["0001.md"]);
    updateCard(card.id, { name: "Charizard" });
    expect(fs.readdirSync(cardsDir())).toEqual(["0001-charizard.md"]);
    updateCard(card.id, { name: "リザードン" });
    expect(fs.readdirSync(cardsDir())).toEqual(["0001.md"]);
    deleteCard(card.id);
    expect(fs.readdirSync(cardsDir())).toEqual([]);
  });

  it("writes the explainer with the very first card, not on a delay", () => {
    createCard({ game: "pokemon", name: "First ever" });
    expect(fs.existsSync(path.join(collectionDir(), "README.md"))).toBe(true);
  });

  it("follows a rename and forgets a deleted card", () => {
    const card = createCard({ game: "pokemon", name: "Pikachu", setName: "Base Set" });
    expect(fs.readdirSync(cardsDir())).toEqual(["0001-pikachu-base-set.md"]);
    updateCard(card.id, { name: "Surfing Pikachu" });
    expect(fs.readdirSync(cardsDir())).toEqual(["0001-surfing-pikachu-base-set.md"]);
    deleteCard(card.id);
    expect(fs.readdirSync(cardsDir())).toEqual([]);
  });

  it("takes an undone sale back out of the file", () => {
    const card = createCard({ game: "pokemon", name: "Mewtwo", quantity: 2 });
    const sale = recordSale(card.id, { quantity: 1, unitPrice: 90 });
    expect(fileFor(card.id)).toContain("## Sales");
    deleteSale(sale.id);
    expect(fileFor(card.id)).not.toContain("## Sales");
  });

  it("lists the whole collection in an index", () => {
    createCard({ game: "pokemon", name: "Alakazam", setName: "Base Set", quantity: 2 });
    const b = createCard({ game: "yugioh", name: "Dark Magician" });
    addSnapshot(b.id, summary(50, "2026-01-01T00:00:00.000Z"));
    flushCollection();
    const index = fs.readFileSync(path.join(collectionDir(), "index.md"), "utf8");
    expect(index).toContain("[Alakazam](cards/0001-alakazam-base-set.md)");
    expect(index).toContain("[Dark Magician](cards/0002-dark-magician.md)");
    expect(index).toContain("$50.00");
    expect(fs.existsSync(path.join(collectionDir(), "README.md"))).toBe(true);
  });
});

describe("files written by something other than this app", () => {
  it("does not let a file reshape what it is read into", () => {
    const text = [
      "---",
      'name: "Sneaky"',
      'game: "pokemon"',
      '__proto__: {"quantity": 999}',
      'external_ids: {"__proto__": "x", "pricecharting": "42"}',
      'manual_graded: {"__proto__": 1, "PSA 10": 500}',
      "---",
      "",
      "# Sneaky",
      "",
    ].join("\n");
    const parsed = parseCardMarkdown(text)!;
    expect(parsed.input.quantity).toBe(1);
    expect(parsed.input.externalIds).toEqual({ pricecharting: "42" });
    expect(parsed.input.manualGraded).toEqual({ "PSA 10": 500 });
    expect(Object.getPrototypeOf(parsed.input.externalIds!)).toBe(Object.prototype);
  });

  it("ignores an id no database could hold", () => {
    const text = ["---", 'name: "Huge"', 'game: "pokemon"', "id: 1e30", "---", "", "# Huge", ""].join("\n");
    const parsed = parseCardMarkdown(text)!;
    expect(parsed.id).toBeNull();
    expect(parsed.warnings.join(" ")).toMatch(/outside the usable range/);
  });

  it("keeps a source label that has brackets of its own", () => {
    const text = [
      "---",
      'name: "Bolt"',
      'game: "mtg"',
      "---",
      "",
      "# Bolt",
      "",
      "## Value history",
      "",
      "| Date | Your copy | Ungraded | Graded | Basis |",
      "| --- | --- | --- | --- | --- |",
      "| 2026-02-02T10:00:00.000Z | $8.00 | $8.00 (Scryfall (TCGplayer-derived USD)) | PSA 10 $200.00 (PriceCharting) | Ungraded. |",
      "",
    ].join("\n");
    const parsed = parseCardMarkdown(text)!;
    expect(parsed.snapshots[0].summary).toMatchObject({
      ungraded: 8,
      ungradedSource: "Scryfall (TCGplayer-derived USD)",
      graded: { "PSA 10": 200 },
      gradedSource: "PriceCharting",
    });
  });

  it("is not confused by a card named after one of its own sections", () => {
    const card = createCard({ game: "pokemon", name: "Notes", notes: "The real note." });
    const parsed = parseCardMarkdown(fileFor(card.id))!;
    expect(parsed.input.name).toBe("Notes");
    expect(parsed.input.notes).toBe("The real note.");
  });

  it("keeps a note that looks like the rest of the file", () => {
    const card = createCard({
      game: "pokemon",
      name: "Meta",
      notes: "## Sales\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n\n---\n\n\n# The end\n\n\\# already escaped",
    });
    const parsed = parseCardMarkdown(fileFor(card.id))!;
    expect(parsed.input.notes).toBe(card.notes);
    expect(parsed.sales).toEqual([]);
  });
});

describe("recovering a collection from its files", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("rebuilds a collection into an empty database", () => {
    const a = createCard({ game: "pokemon", name: "Charizard", setName: "Base Set", quantity: 2, purchasePrice: 100 });
    addSnapshot(a.id, summary(300, "2026-01-02T10:00:00.000Z"));
    recordSale(a.id, { quantity: 1, unitPrice: 500, fees: 20 });
    createCard({ game: "sports", name: "Ken Griffey Jr.", year: 1989, location: "Box A" });
    flushCollection();
    const files = readCardFiles();
    expect(files).toHaveLength(2);

    setDb(openDatabase(":memory:"));
    expect(listCards()).toHaveLength(0);
    const result = importCardFiles(files);
    expect(result).toMatchObject({ created: 2, replaced: 0, sales: 1, prices: 1 });
    expect(result.skipped).toEqual([]);

    const cards = listCards();
    expect(cards).toHaveLength(2);
    const charizard = cards.find((c) => c.name === "Charizard")!;
    expect(charizard.id).toBe(a.id);
    expect(charizard).toMatchObject({ quantity: 1, purchasePrice: 100, setName: "Base Set" });
    expect(listCards({ location: "Box A" })).toHaveLength(1);
  });

  it("recognises a card it already holds when the file's id is taken", () => {
    createCard({ game: "pokemon", name: "Snorlax", setName: "Jungle", quantity: 3 });
    flushCollection();
    const files = readCardFiles();

    // A different collection, where id 1 is somebody else entirely.
    setDb(openDatabase(":memory:"));
    createCard({ game: "yugioh", name: "Dark Magician" });
    createCard({ game: "pokemon", name: "Snorlax", setName: "Jungle", quantity: 1 });
    const first = importCardFiles(files);
    expect(first).toMatchObject({ created: 0, replaced: 1 });
    expect(listCards().find((c) => c.name === "Snorlax")!.quantity).toBe(3);
    // ...and doing it again still changes nothing.
    expect(importCardFiles(files)).toMatchObject({ created: 0, replaced: 1 });
    expect(listCards()).toHaveLength(2);
  });

  it("does not read the folder's own index or explainer as cards", () => {
    createCard({ game: "pokemon", name: "Snorlax" });
    flushCollection();
    const readme = fs.readFileSync(path.join(collectionDir(), "README.md"), "utf8");
    const index = fs.readFileSync(path.join(collectionDir(), "index.md"), "utf8");
    expect(parseCardMarkdown(readme)).toBeNull();
    expect(parseCardMarkdown(index)).toBeNull();
  });

  it("is safe to run twice", () => {
    createCard({ game: "pokemon", name: "Snorlax", quantity: 3 });
    flushCollection();
    const files = readCardFiles();
    setDb(openDatabase(":memory:"));
    importCardFiles(files);
    const second = importCardFiles(readCardFiles());
    expect(second).toMatchObject({ created: 0, replaced: 1 });
    expect(listCards()).toHaveLength(1);
  });

  it("writes the recovered card back under the id its file claimed", () => {
    createCard({ game: "pokemon", name: "Filler" });
    createCard({ game: "pokemon", name: "Filler two" });
    const zapdos = createCard({ game: "pokemon", name: "Zapdos", setName: "Base Set" });
    flushCollection();
    const file = readCardFiles().find((f) => f.name.includes("zapdos"))!;

    setDb(openDatabase(":memory:"));
    importCardFiles([file]);
    expect(listCards()[0].id).toBe(zapdos.id);
    expect(fs.readdirSync(cardsDir())).toContain(`000${zapdos.id}-zapdos-base-set.md`);
  });

  it("never overwrites a card that merely shares an id", () => {
    createCard({ game: "pokemon", name: "Somebody Else's Charizard", setName: "Base Set" });
    flushCollection();
    const [stranger] = readCardFiles();

    setDb(openDatabase(":memory:"));
    const mine = createCard({ game: "yugioh", name: "Dark Magician" });
    const result = importCardFiles([stranger]);
    expect(result).toMatchObject({ created: 1, replaced: 0 });
    expect(result.warnings[0].message).toContain("Dark Magician");
    const cards = listCards();
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.id === mine.id)!.name).toBe("Dark Magician");
  });

  it("keeps handing out fresh ids after adopting the ones in the files", () => {
    createCard({ game: "pokemon", name: "First" });
    createCard({ game: "pokemon", name: "Second" });
    createCard({ game: "pokemon", name: "Third" });
    flushCollection();
    const files = readCardFiles();
    setDb(openDatabase(":memory:"));
    importCardFiles([files[2]]);
    const next = createCard({ game: "pokemon", name: "Fourth" });
    expect(next.id).toBeGreaterThan(3);
  });

  it("loses a mangled row, not the card", () => {
    const card = createCard({ game: "pokemon", name: "Gyarados", quantity: 2 });
    recordSale(card.id, { quantity: 1, unitPrice: 30 });
    const broken = fileFor(card.id).replace(/^\| 2026.*$/m, "| what | even | is | this |");
    const parsed = parseCardMarkdown(broken)!;
    expect(parsed.input.name).toBe("Gyarados");
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it("rebuilds the folder from the database without deleting cards it does not have", () => {
    createCard({ game: "pokemon", name: "Eevee" });
    // A card this database has never heard of: the folder may be the only copy
    // of it left, so a rebuild counts it rather than deleting it.
    fs.writeFileSync(path.join(cardsDir(), "9999-vaporeon.md"), '---\nid: 9999\nname: "Vaporeon"\n---\n\n# Vaporeon\n');
    // A half-written file from a crash belongs to nobody.
    fs.writeFileSync(path.join(cardsDir(), "0001-half-written.md.tmp"), "half\n");
    const result = rebuildCollection(listCards());
    expect(result).toMatchObject({ written: 1, orphans: 1 });
    expect(fs.readdirSync(cardsDir()).sort()).toEqual(["0001-eevee.md", "9999-vaporeon.md"]);
    expect(collectionStatus().files).toBe(2);
  });

  it("clears a file left behind by a card it has just rewritten", () => {
    const card = createCard({ game: "pokemon", name: "Eevee" });
    fs.writeFileSync(path.join(cardsDir(), `000${card.id}-old-name.md`), "stale\n");
    expect(rebuildCollection(listCards())).toMatchObject({ written: 1, orphans: 0 });
    expect(fs.readdirSync(cardsDir())).toEqual(["0001-eevee.md"]);
  });

  it("survives losing the database entirely", () => {
    // The whole promise: throw away everything but the folder, and the
    // collection still values the same.
    const a = createCard({ game: "pokemon", name: "Charizard", setName: "Base Set", quantity: 2, purchasePrice: 100 });
    const b = createCard({ game: "mtg", name: "Black Lotus", quantity: 1, purchasePrice: 400 });
    // Several prices each, so the rebuilt history has to keep its direction:
    // the newest price is the one the portfolio is valued at.
    addSnapshot(a.id, summary(120, "2025-06-02T10:00:00.000Z"));
    addSnapshot(a.id, summary(300, "2026-01-02T10:00:00.000Z"));
    addSnapshot(b.id, summary(7000, "2025-06-02T10:00:00.000Z"));
    addSnapshot(b.id, summary(9000, "2026-01-02T10:00:00.000Z"));
    flushCollection();
    const before = totalValue();
    const files = readCardFiles();

    setDb(openDatabase(":memory:"));
    importCardFiles(files);
    expect(totalValue()).toBe(before);
    expect(before).toBe(300 * 2 + 9000);
    const restored = listCards().find((c) => c.name === "Charizard")!;
    expect(listSnapshots(restored.id).map((s) => s.summary.yourCopyValue)).toEqual([300, 120]);
  });
});

/** What the portfolio is worth, the way the app totals it. */
function totalValue(): number {
  const latest = latestSnapshotsByCard();
  return listCards().reduce((sum, card) => sum + (latest.get(card.id)?.summary.yourCopyValue ?? 0) * card.quantity, 0);
}
