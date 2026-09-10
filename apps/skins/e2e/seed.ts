import { addAcquisition, addSnapshot, createItem } from "../src/lib/items";
import { flushCollection } from "../src/lib/markdown/mirror";
import { recordSale } from "../src/lib/sales";
import { READ_DATA_DIR } from "./data-dir";

/**
 * Build the inventory the specs read.
 *
 * This goes through the repository rather than the API, because it has to run
 * before the server does — which also means the fixture is built by the same
 * code paths the app writes through, rather than shaped to suit the specs.
 *
 * Only the reading inventory is seeded. The specs that add and import get an
 * empty one of their own, so what they write cannot move the totals the
 * reading specs are held to.
 *
 * Nothing here assumes it runs before the server: the directory is new every
 * run, and both sides open the same file lazily, so whichever starts first the
 * tests still see a seeded inventory. Clearing the directory instead would risk
 * pulling it out from under a server that had already answered a readiness
 * probe against it.
 */
export default async function seed() {
  process.env.SKINS_DATA_DIR = READ_DATA_DIR;

  /**
   * A recorded price, optionally with what each market was showing.
   *
   * The quotes are what the spread view reads, so a snapshot without them is an
   * item with a value and nothing to compare — which is itself a state worth
   * having in the fixture.
   */
  const price = (
    id: number,
    at: string,
    value: number,
    markets: Partial<Record<"skinport" | "steam" | "csfloat", number>> = {},
  ) =>
    addSnapshot(id, {
      currency: "USD" as const,
      fetchedAt: at,
      market: value,
      marketSource: "Skinport",
      yourCopyValue: value,
      yourCopyBasis: "Skinport lowest ask",
      quotes: Object.entries(markets).map(([source, price]) => ({
        source: source as "skinport" | "steam" | "csfloat",
        sourceLabel: { skinport: "Skinport", steam: "Steam", csfloat: "CSFloat" }[source as "skinport"],
        currency: "USD" as const,
        url: null,
        matchedName: "",
        price,
        volume: null,
        fetchedAt: at,
      })),
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
  // A real spread between the cash markets — and trade locked, so it cannot
  // be acted on. Steam shows the highest number of all and still cannot win.
  price(knife.id, "2026-06-01T00:00:00.000Z", 1180, { skinport: 1180, csfloat: 1150, steam: 1400 });

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
  // Only one market listing it, so there is nothing to compare.
  price(clean.id, "2026-06-01T00:00:00.000Z", 51, { skinport: 51 });

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
  // Worth moving, and nothing stopping it.
  price(rough.id, "2026-06-01T00:00:00.000Z", 34, { skinport: 34, csfloat: 33 });

  const cases = createItem({ marketHashName: "Clutch Case", category: "case", quantity: 20, purchasePrice: 0.42 });
  addAcquisition(cases.id, { quantity: 15, unitCost: 1.15 });
  // Pennies apart per copy, across thirty-five copies.
  price(cases.id, "2026-06-01T00:00:00.000Z", 1.4, { skinport: 1.4, csfloat: 1.35 });

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
  price(stattrak.id, "2026-06-01T00:00:00.000Z", 128, { skinport: 128 });

  const sold = createItem({ marketHashName: "Chroma 3 Case", category: "case", quantity: 6, purchasePrice: 0.3 });
  recordSale(sold.id, { quantity: 6, unitPrice: 0.55, fees: 0.4, venue: "Skinport" });

  flushCollection();
}
