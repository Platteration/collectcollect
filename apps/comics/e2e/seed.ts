import { engine } from "../src/lib/engine";
import { READ_DATA_DIR } from "./data-dir";

/**
 * Build the collection the specs read.
 *
 * This goes through the engine rather than the API, because it has to run
 * before the server does -- which also means the fixture is built by the same
 * code paths the app writes through, rather than shaped to suit the specs.
 *
 * Only the reading collection is seeded. The specs that add get an empty one
 * of their own, so what they write cannot move the totals the reading specs
 * are held to.
 *
 * The long box is chosen to hold every state the engine has to get right at
 * once: a slabbed key, a stack of a raw key, one nobody has priced, and one
 * sold and gone.
 *
 * Totals the reading specs are held to:
 *  - held: 3 rows, 5 copies (the slab, three raw copies, the unpriced key)
 *  - worth: $1,454.00 (1400 for the slab + 3 x 18 for the stack)
 *  - invested in what is priced: $924.00 (900 + 3 x 8), so +$530.00 unrealised
 *  - realised: one sale, $300 less $10 of fees less the $240 it cost = $50.00
 */
export default async function seed() {
  process.env.COMICS_DATA_DIR = READ_DATA_DIR;

  const price = (id: number, at: string, value: number) =>
    engine.refresh.addManualSnapshot(id, { value, at, note: "Auction hammer" });

  // A slabbed key: one specific object, never a stack.
  const asm = engine.repo.createItem({
    title: "The Amazing Spider-Man",
    publisher: "Marvel",
    issueNumber: "300",
    volume: 1,
    coverDate: "1988-05",
    keyFlags: ["first_appearance"],
    keyOf: "Venom (Eddie Brock)",
    slabbed: true,
    gradingCompany: "cgc",
    grade: "9.4",
    certNumber: "2036123-004",
    pageQuality: "white",
    purchasePrice: 900,
    location: "Safe",
    notes: "Todd McFarlane cover; 25th anniversary issue.",
  });
  price(asm.id, "2025-06-01T00:00:00.000Z", 1150);
  price(asm.id, "2026-06-01T00:00:00.000Z", 1400);

  // Three raw copies of one issue at one estimated grade: one row, three copies.
  const xmen = engine.repo.createItem({
    title: "X-Men",
    publisher: "Marvel",
    issueNumber: "1",
    volume: 2,
    coverDate: "1991-10",
    variant: "Cover E (gatefold)",
    keyFlags: ["first_issue"],
    slabbed: false,
    grade: "9.4",
    quantity: 3,
    purchasePrice: 8,
    location: "Long box 2",
  });
  price(xmen.id, "2025-06-01T00:00:00.000Z", 12);
  price(xmen.id, "2026-06-01T00:00:00.000Z", 18);

  // Bought, never priced: left out of the return rather than counted as free.
  engine.repo.createItem({
    title: "The Incredible Hulk",
    publisher: "Marvel",
    issueNumber: "181",
    volume: 1,
    coverDate: "1974-11",
    keyFlags: ["first_appearance"],
    keyOf: "Wolverine",
    slabbed: false,
    grade: "4.0",
    pageQuality: "off_white",
    purchasePrice: 1800,
    location: "Safe",
  });

  // Sold and gone, but its history stays.
  const saga = engine.repo.createItem({
    title: "Saga",
    publisher: "Image",
    issueNumber: "1",
    volume: 1,
    coverDate: "2012-03",
    keyFlags: ["first_issue", "first_appearance"],
    keyOf: "Hazel, Alana and Marko",
    slabbed: true,
    gradingCompany: "cbcs",
    grade: "9.8",
    certNumber: "19-2C4E7A1B-001",
    pageQuality: "white",
    purchasePrice: 240,
    location: "Safe",
  });
  engine.sales.recordSale(saga.id, { quantity: 1, unitPrice: 300, fees: 10, venue: "eBay" });

  engine.mirror.flushCollection();
}
