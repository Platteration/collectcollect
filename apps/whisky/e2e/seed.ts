import { engine } from "../src/lib/engine";
import { READ_DATA_DIR } from "./data-dir";

/**
 * Build the collection the specs read.
 *
 * This goes through the engine rather than the API, because it has to run
 * before the server does — which also means the fixture is built by the same
 * code paths the app writes through, rather than shaped to suit the specs.
 *
 * Only the reading collection is seeded. The specs that add, import and open
 * get an empty one of their own, so what they write cannot move the totals the
 * reading specs are held to.
 *
 * The shelf is chosen to hold every state the engine has to get right at once:
 * a sealed stack, a bottle that is one specific object, one already open, one
 * nobody has priced, and one sold and gone.
 */
export default async function seed() {
  process.env.WHISKY_DATA_DIR = READ_DATA_DIR;

  const price = (id: number, at: string, value: number) =>
    engine.refresh.addManualSnapshot(id, { value, at, note: "Auction hammer" });

  // Three of one bottling, bought together: one row, one price, three copies.
  const springbank = engine.repo.createItem({
    distillery: "Springbank",
    expression: "10 Year Old",
    ageStatement: 10,
    abv: 46,
    region: "campbeltown",
    packaging: "box",
    quantity: 3,
    purchasePrice: 75,
    location: "Cabinet",
  });
  price(springbank.id, "2025-06-01T00:00:00.000Z", 90);
  price(springbank.id, "2026-06-01T00:00:00.000Z", 100);

  // A numbered bottle: one specific object, never a stack.
  const portEllen = engine.repo.createItem({
    distillery: "Port Ellen",
    expression: "1979 Annual Release",
    ageStatement: 27,
    vintage: 1979,
    abv: 54.2,
    bottleNumber: "Bottle 2417 of 5400",
    region: "islay",
    packaging: "box",
    purchasePrice: 900,
    location: "Safe",
    notes: "Closed distillery. Capsule perfect.",
  });
  price(portEllen.id, "2025-07-01T00:00:00.000Z", 1800);
  price(portEllen.id, "2026-06-15T00:00:00.000Z", 2000);

  // Open, and therefore frozen and out of the total — even though it carries a
  // recorded price of its own, which must not reach the portfolio.
  const lagavulin = engine.repo.createItem({
    distillery: "Lagavulin",
    expression: "16 Year Old",
    ageStatement: 16,
    abv: 43,
    region: "islay",
    packaging: "box",
    sealed: false,
    openedAt: "2025-12-25",
    fillLevel: 60,
    frozenValue: 80,
    purchasePrice: 70,
    location: "Trolley",
  });
  price(lagavulin.id, "2026-06-01T00:00:00.000Z", 500);

  // Bought, never priced: left out of the return rather than counted as free.
  engine.repo.createItem({
    distillery: "Glenfarclas",
    expression: "105 Cask Strength",
    abv: 60,
    bottleSize: 1000,
    region: "speyside",
    packaging: "tube",
    purchasePrice: 58,
    location: "Cabinet",
  });

  // Sold and gone, but its history stays.
  const yamazaki = engine.repo.createItem({
    distillery: "Yamazaki",
    expression: "12 Year Old",
    ageStatement: 12,
    abv: 43,
    region: "japan",
    packaging: "box",
    purchasePrice: 95,
    location: "Safe",
  });
  engine.sales.recordSale(yamazaki.id, { quantity: 1, unitPrice: 300, fees: 10, venue: "Whisky Auctioneer" });

  engine.mirror.flushCollection();
}
