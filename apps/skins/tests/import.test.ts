import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { getItem, listItems } from "@/lib/items";
import { listLots, verifyLotInvariant } from "@/lib/acquisitions";
import { applyImport, exteriorFromName, guessCategory, previewImport } from "@/lib/import";

beforeEach(() => setDb(openDatabase(":memory:")));

const csv = (...lines: string[]) => lines.join("\n");

describe("reading a name", () => {
  it("knows what kind of item it is from how Steam names it", () => {
    expect(guessCategory("★ Karambit | Doppler (Factory New)")).toBe("knife");
    expect(guessCategory("★ Sport Gloves | Pandora's Box (Field-Tested)")).toBe("glove");
    expect(guessCategory("Sticker | Titan | Katowice 2014")).toBe("sticker");
    expect(guessCategory("Clutch Case")).toBe("case");
    expect(guessCategory("Antwerp 2022 Legends Sticker Capsule")).toBe("capsule");
    expect(guessCategory("AK-47 | Redline (Field-Tested)")).toBe("weapon");
    expect(guessCategory("Music Kit | Daniel Sadowski, Crimson Assault")).toBe("music_kit");
    expect(guessCategory("Sealed Graffiti | Recoil AK-47")).toBe("graffiti");
  });

  it("has no answer rather than a wrong one", () => {
    expect(guessCategory("Something Nobody Has Heard Of")).toBeNull();
  });

  it("reads the wear tier out of the brackets", () => {
    expect(exteriorFromName("AK-47 | Redline (Field-Tested)")).toBe("field_tested");
    expect(exteriorFromName("★ Karambit | Doppler (Factory New)")).toBe("factory_new");
    expect(exteriorFromName("Clutch Case")).toBeNull();
    expect(exteriorFromName("AK-47 | Redline (Not A Tier)")).toBeNull();
  });
});

describe("previewing a file", () => {
  it("maps the columns it recognises and names the ones it does not", () => {
    const preview = previewImport(
      csv("Item,Float,Paid,Storage,Mystery", "AK-47 | Redline (Field-Tested),0.2213,42,Backpack,x"),
    );
    expect(preview.mapping).toMatchObject({ name: "Item", floatValue: "Float", purchasePrice: "Paid", storageUnit: "Storage" });
    expect(preview.unmapped).toEqual(["Mystery"]);
    expect(preview.usable).toBe(1);
  });

  it("fills in from the name what the file does not spell out", () => {
    const [row] = previewImport(csv("name", "StatTrak™ AK-47 | Redline (Field-Tested)")).rows;
    expect(row.input).toMatchObject({
      category: "weapon",
      weapon: "AK-47",
      finish: "Redline",
      exterior: "field_tested",
      stattrak: true,
      souvenir: false,
    });
  });

  it("lets a float settle the wear tier over a column that disagrees", () => {
    // The tier in a name is derived from the float, so a file claiming both is
    // describing an object that cannot exist.
    const [row] = previewImport(csv("name,wear,float", "AK-47 | Redline (Field-Tested),Factory New,0.5")).rows;
    expect(row.input!.exterior).toBe("battle_scarred");
    expect(row.input!.floatValue).toBe(0.5);
  });

  it("drops a float that is not a wear value, and says it did", () => {
    const [row] = previewImport(csv("name,float", "AK-47 | Redline (Field-Tested),1.4")).rows;
    expect(row.input!.floatValue).toBeNull();
    expect(row.warning).toMatch(/not a wear value/);
    // The tier printed in the name still stands.
    expect(row.input!.exterior).toBe("field_tested");
  });

  it("takes a wear column in any of the forms people write it", () => {
    for (const [written, expected] of [
      ["FN", "factory_new"],
      ["Minimal Wear", "minimal_wear"],
      ["field-tested", "field_tested"],
      ["ww", "well_worn"],
      ["Battle-Scarred", "battle_scarred"],
    ] as const) {
      const [row] = previewImport(csv("name,wear", `Glock-18 | Fade,${written}`)).rows;
      expect(row.input!.exterior, written).toBe(expected);
    }
  });

  it("takes a wear value as evidence that this is something you can hold", () => {
    // The name alone says nothing here, but only weapons, knives and gloves
    // have wear at all — and a knife or a glove would carry a star.
    const [row] = previewImport(csv("name,float", "Glock-18 | Fade,0.01")).rows;
    expect(row.input!.category).toBe("weapon");
    expect(row.warning).toMatch(/taken as a weapon/);
  });

  it("still has no answer for a row with nothing to go on", () => {
    const [row] = previewImport(csv("name,cost", "Mystery Object,5")).rows;
    expect(row.input).toBeNull();
    expect(row.problem).toMatch(/what kind of item/);
  });

  it("says which row it could not read instead of dropping it", () => {
    const preview = previewImport(csv("name,paid", "AK-47 | Redline (Field-Tested),42", ",13", "Mystery Object,5"));
    expect(preview.total).toBe(3);
    expect(preview.usable).toBe(1);
    expect(preview.rows[1].problem).toMatch(/No item name/);
    expect(preview.rows[2].problem).toMatch(/what kind of item/);
    // Line numbers point back at the file, counting the header as line 1.
    expect(preview.rows.map((r) => r.line)).toEqual([2, 3, 4]);
  });

  it("takes a chosen kind for the rows that do not say", () => {
    const preview = previewImport(csv("name", "Mystery Object"), { category: "other" });
    expect(preview.usable).toBe(1);
    expect(preview.rows[0].input!.category).toBe("other");
  });

  it("keeps the line numbers right when the file has blank rows", () => {
    const preview = previewImport(csv("name", "", "Clutch Case", "", "Chroma Case"));
    expect(preview.rows.map((r) => r.line)).toEqual([3, 5]);
  });

  it("reads money however it is written", () => {
    const rows = previewImport(csv("name,cost", "Clutch Case,$1.40", "Chroma Case,\"1,234.50\"", "Gamma Case,free")).rows;
    expect(rows.map((r) => r.input!.purchasePrice)).toEqual([1.4, 1234.5, null]);
  });

  it("has nothing to say about an empty file", () => {
    expect(previewImport("")).toMatchObject({ total: 0, usable: 0, rows: [] });
  });
});

describe("applying a file", () => {
  it("creates what is new and joins stacks already held", () => {
    applyImport(previewImport(csv("name,qty,cost", "Clutch Case,10,0.42")));
    const result = applyImport(previewImport(csv("name,qty,cost", "Clutch Case,5,1.15", "Chroma Case,2,0.30")));
    expect(result).toMatchObject({ created: 1, merged: 1, skipped: [] });

    const cases = listItems().find((i) => i.marketHashName === "Clutch Case")!;
    expect(cases.quantity).toBe(15);
    // Two purchases at two prices, kept apart.
    expect(listLots(cases.id).map((l) => l.unitCost)).toEqual([0.42, 1.15]);
    expect(verifyLotInvariant()).toEqual([]);
  });

  it("keeps two weapons of the same name as two objects", () => {
    applyImport(
      previewImport(
        csv(
          "name,float,seed",
          "AK-47 | Redline (Field-Tested),0.1601,412",
          "AK-47 | Redline (Field-Tested),0.3702,88",
        ),
      ),
    );
    expect(listItems()).toHaveLength(2);
    expect(listItems().map((i) => i.floatValue).sort()).toEqual([0.1601, 0.3702]);
  });

  it("reports the rows it skipped rather than failing the whole file", () => {
    const result = applyImport(previewImport(csv("name,cost", "Clutch Case,1", ",2", "Clutch Case,3")));
    expect(result.created).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.skipped).toEqual([{ line: 3, reason: "No item name in this row" }]);
  });

  it("brings the trade lock and the storage unit with it", () => {
    applyImport(
      previewImport(csv("name,storage,tradelock", "★ Karambit | Doppler (Factory New),Backpack,2026-09-15")),
    );
    const item = listItems()[0];
    expect(item.storageUnit).toBe("Backpack");
    expect(item.tradableAfter).toBe(new Date("2026-09-15").toISOString());
    expect(item.category).toBe("knife");
    expect(item.rarity).toBeNull();
  });

  it("leaves a cost nobody wrote down as unknown rather than zero", () => {
    applyImport(previewImport(csv("name,qty", "Clutch Case,3")));
    const item = listItems()[0];
    expect(item.purchasePrice).toBeNull();
    expect(listLots(item.id)[0].unitCost).toBeNull();
    expect(getItem(item.id)!.quantity).toBe(3);
  });
});
