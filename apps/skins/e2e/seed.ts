import { addAcquisition, addSnapshot, createItem } from "../src/lib/items";
import { flushCollection } from "../src/lib/markdown/mirror";
import { recordSale } from "../src/lib/sales";
import { E2E_DATA_DIR } from "./data-dir";

/**
 * Build the inventory the specs read.
 *
 * There is no intake API yet, so this goes through the repository directly —
 * which also means the specs exercise the same write path the app will, rather
 * than a fixture shaped to suit them.
 *
 * Nothing here assumes it runs before the server: the directory is new every
 * run, and both sides open the same file lazily, so whichever starts first the
 * tests still see a seeded inventory. Clearing the directory instead would risk
 * pulling it out from under a server that had already answered a readiness
 * probe against it.
 */
export default async function seed() {
  process.env.SKINS_DATA_DIR = E2E_DATA_DIR;

  const price = (id: number, at: string, value: number) =>
    addSnapshot(id, {
      currency: "USD" as const,
      fetchedAt: at,
      market: value,
      marketSource: "Skinport",
      yourCopyValue: value,
      yourCopyBasis: "Skinport lowest ask",
      quotes: [],
      errors: [],
    });

  const knife = createItem({
    marketHashName: "★ Karambit | Doppler (Factory New)",
    category: "knife",
    weapon: "Karambit",
    finish: "Doppler",
    rarity: "extraordinary",
    floatValue: 0.0141,
    paintSeed: 387,
    purchasePrice: 900,
    storageUnit: "Backpack",
    tradableAfter: new Date(Date.now() + 5 * 864e5).toISOString(),
  });
  price(knife.id, "2026-01-15T00:00:00.000Z", 940);
  price(knife.id, "2026-06-01T00:00:00.000Z", 1180);

  // Two of the same skin at the same wear tier: different objects, and the app
  // must never treat them as one.
  const clean = createItem({
    marketHashName: "AK-47 | Redline (Field-Tested)",
    category: "weapon",
    weapon: "AK-47",
    finish: "Redline",
    rarity: "classified",
    collection: "The Huntsman Collection",
    floatValue: 0.1601,
    paintSeed: 412,
    purchasePrice: 42,
    notes: "First one I ever bought.",
    stickers: [
      { slot: 0, name: "iBUYPOWER | Katowice 2014", marketHashName: "Sticker | iBUYPOWER | Katowice 2014", wear: 0 },
      { slot: 1, name: "Titan | Katowice 2014", marketHashName: null, wear: 0.35 },
    ],
  });
  price(clean.id, "2026-06-01T00:00:00.000Z", 51);

  const rough = createItem({
    marketHashName: "AK-47 | Redline (Field-Tested)",
    category: "weapon",
    weapon: "AK-47",
    finish: "Redline",
    rarity: "classified",
    floatValue: 0.3702,
    paintSeed: 88,
    purchasePrice: 31,
  });
  price(rough.id, "2026-06-01T00:00:00.000Z", 34);

  const cases = createItem({ marketHashName: "Clutch Case", category: "case", quantity: 20, purchasePrice: 0.42 });
  addAcquisition(cases.id, { quantity: 15, unitCost: 1.15 });
  price(cases.id, "2026-06-01T00:00:00.000Z", 1.4);

  const stattrak = createItem({
    marketHashName: "StatTrak™ AWP | Asiimov (Well-Worn)",
    category: "weapon",
    weapon: "AWP",
    finish: "Asiimov",
    rarity: "covert",
    stattrak: true,
    floatValue: 0.4102,
    paintSeed: 91,
  });
  price(stattrak.id, "2026-06-01T00:00:00.000Z", 128);

  const sold = createItem({ marketHashName: "Chroma 3 Case", category: "case", quantity: 6, purchasePrice: 0.3 });
  recordSale(sold.id, { quantity: 6, unitPrice: 0.55, fees: 0.4, venue: "Skinport" });

  flushCollection();
}
