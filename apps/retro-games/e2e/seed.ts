import { engine } from "../src/lib/engine";
import { READ_DATA_DIR } from "./data-dir";

/**
 * Build the collection the specs read.
 *
 * This goes through the engine rather than the API, because it has to run
 * before the server does — which also means the fixture is built by the same
 * code paths the app writes through, rather than shaped to suit the specs.
 *
 * Only the reading collection is seeded. The specs that add and import get an
 * empty one of their own, so what they write cannot move the totals the
 * reading specs are held to.
 *
 * The shelf is chosen to hold every state the engine has to get right at
 * once: a complete-in-box stack, a graded copy that is one specific object,
 * one nobody has priced, and one sold and gone.
 */
export default async function seed() {
  process.env.RETRO_GAMES_DATA_DIR = READ_DATA_DIR;

  const price = (id: number, at: string, value: number) =>
    engine.refresh.addManualSnapshot(id, { value, at, note: "Auction hammer" });

  // Three complete copies, bought together: one row, one price, three copies.
  const mario = engine.repo.createItem({
    title: "Super Mario 64",
    platform: "n64",
    region: "ntsc_u",
    releaseYear: 1996,
    publisher: "Nintendo",
    completeness: "cib",
    boxCondition: "very_good",
    manualCondition: "near_mint",
    mediaCondition: "near_mint",
    quantity: 3,
    purchasePrice: 45,
    location: "Shelf A",
  });
  price(mario.id, "2025-06-01T00:00:00.000Z", 90);
  price(mario.id, "2026-06-01T00:00:00.000Z", 100);

  // A graded copy: one specific object, never a stack.
  const zelda = engine.repo.createItem({
    title: "The Legend of Zelda: Ocarina of Time",
    platform: "n64",
    region: "ntsc_u",
    releaseYear: 1998,
    publisher: "Nintendo",
    completeness: "graded",
    gradingCompany: "wata",
    grade: "9.4 A+",
    certNumber: "0921347001",
    boxCondition: "near_mint",
    purchasePrice: 800,
    location: "Safe",
    notes: "Gold cartridge, first print.",
  });
  price(zelda.id, "2025-07-01T00:00:00.000Z", 1800);
  price(zelda.id, "2026-06-15T00:00:00.000Z", 2000);

  // Bought, never priced: left out of the return rather than counted as free.
  engine.repo.createItem({
    title: "Chrono Trigger",
    platform: "snes",
    region: "ntsc_u",
    releaseYear: 1995,
    publisher: "Square",
    completeness: "loose",
    mediaCondition: "very_good",
    purchasePrice: 120,
    location: "Shelf A",
  });

  // Sold and gone, but its history stays.
  const earthbound = engine.repo.createItem({
    title: "EarthBound",
    platform: "snes",
    region: "ntsc_u",
    releaseYear: 1995,
    publisher: "Nintendo",
    completeness: "cib",
    boxCondition: "good",
    manualCondition: "good",
    mediaCondition: "very_good",
    variant: "Big box with player's guide",
    purchasePrice: 600,
    location: "Safe",
  });
  engine.sales.recordSale(earthbound.id, { quantity: 1, unitPrice: 900, fees: 25, venue: "eBay" });

  engine.mirror.flushCollection();
}
