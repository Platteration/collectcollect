import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { getItem, intakeItem, itemsMissingFrom, listItems, syncFromInventory, updateItem } from "@/lib/items";
import { listLots, verifyLotInvariant } from "@/lib/acquisitions";
import type { SteamAsset, SteamDescription, SteamInventory } from "@/lib/steam/inventory";
import {
  SteamInventoryError,
  fetchInventory,
  isSteamId64,
  nameTagFrom,
  parseInventory,
  stickersFrom,
  tradableAfterFrom,
} from "@/lib/steam/inventory";

const STEAM_ID = "76561198000000001";

beforeEach(() => setDb(openDatabase(":memory:")));

/** A fetch stub answering with one recorded body. */
function answering(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

/** A description in the shape Steam actually sends. */
function description(overrides: Record<string, unknown> = {}) {
  return {
    classid: "310776560",
    instanceid: "302028390",
    market_hash_name: "AK-47 | Redline (Field-Tested)",
    name: "AK-47 | Redline",
    type: "Classified Rifle",
    icon_url: "IconHash123",
    tradable: 1,
    marketable: 1,
    tags: [
      { category: "Type", internal_name: "CSGO_Type_Rifle", localized_tag_name: "Rifle" },
      { category: "Weapon", internal_name: "weapon_ak47", localized_tag_name: "AK-47" },
      { category: "ItemSet", internal_name: "set_huntsman", localized_tag_name: "The Huntsman Collection" },
      { category: "Quality", internal_name: "normal", localized_tag_name: "Normal" },
      { category: "Rarity", internal_name: "Rarity_Legendary_Weapon", localized_tag_name: "Classified" },
      { category: "Exterior", internal_name: "WearCategory2", localized_tag_name: "Field-Tested" },
    ],
    actions: [
      {
        name: "Inspect in Game...",
        link: "steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S%owner_steamid%A%assetid%D1234",
      },
    ],
    ...overrides,
  };
}

function inventory(descriptions: SteamDescription[], assets: SteamAsset[]): SteamInventory {
  return { success: 1, descriptions, assets, total_inventory_count: assets.length };
}

describe("reading a SteamID64", () => {
  it("takes a real one and refuses everything else", () => {
    expect(isSteamId64(STEAM_ID)).toBe(true);
    expect(isSteamId64(" 76561198000000001 ")).toBe(true);
    for (const bad of ["", "hello", "1234", "8656119000000000", "765611980000000012"]) {
      expect(isSteamId64(bad)).toBe(false);
    }
  });

  it("says what is wrong before making a request", async () => {
    const fetchImpl = answering({});
    await expect(fetchInventory("not-an-id", fetchImpl)).rejects.toThrow(/seventeen digits/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("what Steam answers", () => {
  it("does not blame a privacy setting for a refusal it cannot see the cause of", async () => {
    // A blocked request and a private inventory are the same 403 from here, so
    // the message names both rather than sending someone to change a setting
    // that was never the problem.
    const message = await fetchInventory(STEAM_ID, answering({}, 403)).catch((e: Error) => e.message);
    expect(message).toMatch(/not set to Public/);
    expect(message).toMatch(/proxy or firewall/);
  });

  it("turns a rate limit into something to wait for", async () => {
    await expect(fetchInventory(STEAM_ID, answering({}, 429))).rejects.toThrow(/rate limiting/);
  });

  it("does not take a 200 as success on its own", async () => {
    // Steam answers 200 with success: 0 for an inventory it will not show.
    await expect(fetchInventory(STEAM_ID, answering({ success: 0, error: "Bad state" }))).rejects.toThrow(/Bad state/);
    await expect(fetchInventory(STEAM_ID, answering({ success: 0 }))).rejects.toBeInstanceOf(SteamInventoryError);
  });

  it("reads a good answer", async () => {
    const payload = inventory([description()], [{ assetid: "1", classid: "310776560", instanceid: "302028390", amount: "1" }]);
    expect((await fetchInventory(STEAM_ID, answering(payload))).assets).toHaveLength(1);
  });
});

describe("parsing an inventory", () => {
  it("joins each asset to its description and reads the item out of it", () => {
    const payload = inventory([description()], [{ assetid: "44112233", classid: "310776560", instanceid: "302028390", amount: "1" }]);
    const { items } = parseInventory(payload, STEAM_ID);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      marketHashName: "AK-47 | Redline (Field-Tested)",
      category: "weapon",
      weapon: "AK-47",
      finish: "Redline",
      exterior: "field_tested",
      rarity: "classified",
      collection: "The Huntsman Collection",
      stattrak: false,
      assetId: "44112233",
    });
    expect(items[0].imageUrl).toContain("IconHash123");
    expect(items[0].inspectLink).toContain("A44112233");
    expect(items[0].inspectLink).toContain(STEAM_ID);
  });

  it("leaves the float and the pattern unknown, because Steam does not send them", () => {
    const payload = inventory([description()], [{ assetid: "1", classid: "310776560", instanceid: "302028390", amount: "1" }]);
    const [item] = parseInventory(payload, STEAM_ID).items;
    // A zero here would read as a pristine Factory New, which is the most
    // valuable thing a skin can be.
    expect(item.floatValue).toBeUndefined();
    expect(item.paintSeed).toBeUndefined();
  });

  it("collapses a stack rather than importing it as separate objects", () => {
    const cases = description({
      classid: "22222",
      instanceid: "0",
      market_hash_name: "Clutch Case",
      name: "Clutch Case",
      type: "Base Grade Container",
      tags: [
        { category: "Type", internal_name: "CSGO_Type_WeaponCase", localized_tag_name: "Container" },
        { category: "Rarity", internal_name: "Rarity_Common", localized_tag_name: "Base Grade" },
      ],
      actions: [],
    });
    const payload = inventory(
      [cases],
      [
        { assetid: "1", classid: "22222", instanceid: "0", amount: "1" },
        { assetid: "2", classid: "22222", instanceid: "0", amount: "1" },
        { assetid: "3", classid: "22222", instanceid: "0", amount: "1" },
      ],
    );
    const { items } = parseInventory(payload, STEAM_ID);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    // Five cases pooled into one row cannot claim one of the five asset ids.
    expect(items[0].assetId).toBeNull();
  });

  it("keeps two of the same weapon as two objects", () => {
    const payload = inventory(
      [description()],
      [
        { assetid: "1", classid: "310776560", instanceid: "302028390", amount: "1" },
        { assetid: "2", classid: "310776560", instanceid: "302028390", amount: "1" },
      ],
    );
    const { items } = parseInventory(payload, STEAM_ID);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.assetId)).toEqual(["1", "2"]);
  });

  it("files a knife as a knife and gold, whatever its weapon rarity says", () => {
    const knife = description({
      classid: "33333",
      market_hash_name: "★ Karambit | Doppler (Factory New)",
      type: "★ Covert Knife",
      tags: [
        { category: "Type", internal_name: "CSGO_Type_Knife", localized_tag_name: "Knife" },
        { category: "Quality", internal_name: "unusual", localized_tag_name: "★" },
        { category: "Rarity", internal_name: "Rarity_Ancient_Weapon", localized_tag_name: "Covert" },
        { category: "Exterior", internal_name: "WearCategory0", localized_tag_name: "Factory New" },
      ],
    });
    const [item] = parseInventory(inventory([knife], [{ assetid: "9", classid: "33333", instanceid: "302028390" }]), STEAM_ID).items;
    expect(item.category).toBe("knife");
    expect(item.rarity).toBe("extraordinary");
    expect(item.weapon).toBe("Karambit");
    expect(item.exterior).toBe("factory_new");
  });

  it("reads StatTrak and Souvenir from the quality tag or the name", () => {
    const st = description({
      classid: "44444",
      market_hash_name: "StatTrak™ AK-47 | Redline (Field-Tested)",
      tags: [
        { category: "Type", internal_name: "CSGO_Type_Rifle" },
        { category: "Quality", internal_name: "strange", localized_tag_name: "StatTrak™" },
        { category: "Exterior", internal_name: "WearCategory2" },
      ],
    });
    const souvenir = description({
      classid: "55555",
      market_hash_name: "Souvenir AWP | Dragon Lore (Field-Tested)",
      tags: [
        { category: "Type", internal_name: "CSGO_Type_SniperRifle" },
        { category: "Quality", internal_name: "tournament", localized_tag_name: "Souvenir" },
      ],
    });
    const { items } = parseInventory(
      inventory(
        [st, souvenir],
        [
          { assetid: "1", classid: "44444", instanceid: "302028390" },
          { assetid: "2", classid: "55555", instanceid: "302028390" },
        ],
      ),
      STEAM_ID,
    );
    expect(items[0]).toMatchObject({ stattrak: true, souvenir: false, weapon: "AK-47" });
    expect(items[1]).toMatchObject({ stattrak: false, souvenir: true, weapon: "AWP" });
  });

  it("falls back to the wear tier printed in the name when there is no tag", () => {
    const noTag = description({ tags: [{ category: "Type", internal_name: "CSGO_Type_Rifle" }] });
    const [item] = parseInventory(inventory([noTag], [{ assetid: "1", classid: "310776560", instanceid: "302028390" }]), STEAM_ID).items;
    expect(item.exterior).toBe("field_tested");
  });

  it("counts an asset whose description Steam did not send, instead of dropping it silently", () => {
    const payload = inventory([description()], [{ assetid: "1", classid: "nothing-like-this", instanceid: "0" }]);
    const parsed = parseInventory(payload, STEAM_ID);
    expect(parsed.items).toHaveLength(0);
    expect(parsed.unmatched).toBe(1);
  });

  it("survives an empty answer", () => {
    expect(parseInventory({}, STEAM_ID)).toEqual({ items: [], unmatched: 0 });
  });
});

describe("the details Steam hides in prose", () => {
  it("reads applied stickers out of the HTML blob", () => {
    const stickers = stickersFrom(
      description({
        descriptions: [
          { name: "sticker_info", value: '<br><div id="sticker_info"><center><img src="x"><br>Sticker: Titan | Katowice 2014, Crown (Foil)</center></div>' },
        ],
      }),
    );
    expect(stickers).toEqual([
      { slot: 0, name: "Titan | Katowice 2014", marketHashName: "Sticker | Titan | Katowice 2014", wear: null },
      { slot: 1, name: "Crown (Foil)", marketHashName: "Sticker | Crown (Foil)", wear: null },
    ]);
  });

  it("does not claim a sticker is unscratched when it has no idea", () => {
    // Steam's blob has no wear in it. Zero would say "pristine", which is the
    // most valuable a sticker can be.
    const [sticker] = stickersFrom(description({ descriptions: [{ name: "sticker_info", value: "Sticker: Crown (Foil)" }] }));
    expect(sticker.wear).toBeNull();
  });

  it("has no stickers when there is no blob", () => {
    expect(stickersFrom(description())).toEqual([]);
  });

  it("reads a custom name out of the fraud warning it arrives in", () => {
    expect(nameTagFrom(description({ fraudwarnings: ["Name Tag: ''old faithful''"] }))).toBe("old faithful");
    expect(nameTagFrom(description())).toBeNull();
  });

  it("reads a trade lock when it is there and claims nothing when it is not", () => {
    const locked = description({ owner_descriptions: [{ value: "Tradable After Sep 15, 2026 (07:00:00) GMT" }] });
    expect(tradableAfterFrom(locked)).toBe(new Date("Sep 15, 2026").toISOString());
    // A public read usually has no owner_descriptions at all, and absent must
    // mean "not known", never "not locked".
    expect(tradableAfterFrom(description())).toBeNull();
    expect(tradableAfterFrom(description({ market_tradable_restriction: 7 }))).toBeNull();
  });
});

describe("bringing an inventory in twice", () => {
  it("recognises the same objects rather than duplicating them", () => {
    const payload = inventory(
      [description()],
      [
        { assetid: "1", classid: "310776560", instanceid: "302028390" },
        { assetid: "2", classid: "310776560", instanceid: "302028390" },
      ],
    );
    for (const round of [1, 2]) {
      for (const item of parseInventory(payload, STEAM_ID).items) intakeItem(item);
      expect(listItems(), `round ${round}`).toHaveLength(2);
    }
  });

  it("does not grow a stack on a second read of the same inventory", () => {
    const payload = casesInventory(2);
    expect(syncFromInventory(parseInventory(payload, STEAM_ID).items[0]).result).toBe("created");
    // The second read says two, not four. Treating an inventory reading as an
    // addition would double every stack, and an import is exactly the thing
    // people run more than once.
    expect(syncFromInventory(parseInventory(payload, STEAM_ID).items[0]).result).toBe("unchanged");
    const item = listItems()[0];
    expect(item.quantity).toBe(2);
    expect(listLots(item.id)).toHaveLength(1);
  });

  it("records copies that appeared since the last read as a purchase nobody priced", () => {
    syncFromInventory(parseInventory(casesInventory(2), STEAM_ID).items[0]);
    const outcome = syncFromInventory(parseInventory(casesInventory(5), STEAM_ID).items[0]);
    expect(outcome).toMatchObject({ result: "increased", by: 3 });
    const item = listItems()[0];
    expect(item.quantity).toBe(5);
    expect(listLots(item.id).map((l) => [l.quantity, l.unitCost])).toEqual([
      [2, null],
      [3, null],
    ]);
    expect(verifyLotInvariant()).toEqual([]);
  });

  it("follows a stack down when copies left by some route this app never saw", () => {
    syncFromInventory(parseInventory(casesInventory(5), STEAM_ID).items[0]);
    const outcome = syncFromInventory(parseInventory(casesInventory(1), STEAM_ID).items[0]);
    expect(outcome).toMatchObject({ result: "decreased", by: 4 });
    expect(listItems()[0].quantity).toBe(1);
    expect(verifyLotInvariant()).toEqual([]);
  });

  it("keeps what a stack cost when its count comes back the same", () => {
    const [first] = parseInventory(casesInventory(2), STEAM_ID).items;
    const created = syncFromInventory(first);
    // The owner fills in what they paid; a later import must not wipe it.
    updateItem(created.item.id, { purchasePrice: 1.4 });
    syncFromInventory(parseInventory(casesInventory(2), STEAM_ID).items[0]);
    expect(getItem(created.item.id)!.purchasePrice).toBe(1.4);
  });

  it("names an object the inventory stopped mentioning, and does not remove it", () => {
    const payload = inventory(
      [description()],
      [
        { assetid: "1", classid: "310776560", instanceid: "302028390" },
        { assetid: "2", classid: "310776560", instanceid: "302028390" },
      ],
    );
    for (const item of parseInventory(payload, STEAM_ID).items) syncFromInventory(item);

    const smaller = inventory([description()], [{ assetid: "1", classid: "310776560", instanceid: "302028390" }]);
    const stillThere = parseInventory(smaller, STEAM_ID).items;
    for (const item of stillThere) syncFromInventory(item);

    const missing = itemsMissingFrom(stillThere.map((i) => i.assetId!).filter(Boolean));
    expect(missing.map((i) => i.assetId)).toEqual(["2"]);
    // Traded away, sold elsewhere, or simply in a storage unit the public
    // endpoint does not cover — none of which is reason enough to throw away
    // the record of what it cost.
    expect(listItems()).toHaveLength(2);
  });

  it("brings nothing in with a purchase price, because Steam does not know one", () => {
    const payload = inventory([description()], [{ assetid: "1", classid: "310776560", instanceid: "302028390" }]);
    const [item] = parseInventory(payload, STEAM_ID).items;
    const outcome = intakeItem(item);
    expect(outcome.result).toBe("created");
    // Filling this in from the market price would make every item look like a
    // break-even, which is worse than saying nothing.
    expect(getItem((outcome as { item: { id: number } }).item.id)!.purchasePrice).toBeNull();
  });
});

/** An inventory holding `count` Clutch Cases and nothing else. */
function casesInventory(count: number) {
  const cases = description({
    classid: "22222",
    market_hash_name: "Clutch Case",
    name: "Clutch Case",
    tags: [{ category: "Type", internal_name: "CSGO_Type_WeaponCase" }],
    actions: [],
  });
  return inventory(
    [cases],
    Array.from({ length: count }, (_, i) => ({ assetid: String(i + 1), classid: "22222", instanceid: "302028390" })),
  );
}
