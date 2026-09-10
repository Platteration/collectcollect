import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { toInput } from "@/lib/identify";
import { spec } from "@/lib/spec";
import { isBottleNumber } from "@/lib/types";
import { loadSeed } from "@collectcollect/core/domain/seed";
import { portfolioSeries } from "@collectcollect/core/domain/analytics";

const oogie = { distillery: "Ardbeg", expression: "Uigeadail", abv: 54.2, region: "islay", packaging: "tube" } as const;

describe("the bottle schema", () => {
  it("needs a distillery and an expression, and defaults to a sealed 700 ml bottle", () => {
    expect(() => engine.repo.normalize({ expression: "10" })).toThrow(/Distillery/);
    expect(() => engine.repo.normalize({ distillery: "Ardbeg" })).toThrow(/Expression/);
    expect(engine.repo.normalize(oogie)).toMatchObject({ bottleSize: 700, sealed: true, packaging: "tube", fillLevel: null, openedAt: null, frozenValue: null, quantity: 1 });
  });

  it("checks the numbers", () => {
    expect(() => engine.repo.normalize({ ...oogie, abv: 120 })).toThrow(/ABV/);
    expect(() => engine.repo.normalize({ ...oogie, fillLevel: 140, sealed: false })).toThrow(/Fill level/);
    expect(() => engine.repo.normalize({ ...oogie, region: "mars" as never })).toThrow(/region/i);
  });

  it("tells a bottle number from a batch", () => {
    expect(isBottleNumber("Bottle 123 of 2000")).toBe(true);
    expect(isBottleNumber("123/2000")).toBe(true);
    expect(isBottleNumber("No. 7 / 300")).toBe(true);
    expect(isBottleNumber("Batch 12")).toBe(false);
    expect(isBottleNumber("L2311")).toBe(false);
    expect(isBottleNumber(null)).toBe(false);
  });

  it("reads the words a spreadsheet uses", () => {
    const preview = engine.csv.previewImport(["brand,name,age,strength,size,country,packaging,unopened,qty,paid", "Springbank,10 Year Old,10,46,700,Scotland,Boxed,yes,3,75"].join("\n"));
    expect(preview.usable).toBe(1);
    expect(preview.rows[0].input).toMatchObject({ distillery: "Springbank", expression: "10 Year Old", ageStatement: 10, abv: 46, bottleSize: 700, region: "scotland_blend", packaging: "box", sealed: true, quantity: 3, purchasePrice: 75 });
  });
});

describe("a stack, or one specific bottle", () => {
  it("stacks identical sealed bottles", () => {
    expect(engine.repo.intakeItem({ ...oogie, purchasePrice: 82 }).result).toBe("created");
    expect(engine.repo.intakeItem({ ...oogie, purchasePrice: 90, quantity: 2 }).result).toBe("merged");
    const [item] = engine.repo.listItems();
    expect(item.quantity).toBe(3);
    expect(engine.ledger.listLots(item.id).map((l) => [l.quantity, l.unitCost])).toEqual([
      [1, 82],
      [2, 90],
    ]);
  });

  it("keeps a different bottling, size or packaging apart", () => {
    engine.repo.intakeItem(oogie);
    expect(engine.repo.intakeItem({ ...oogie, bottlingYear: 2015 }).result).toBe("created");
    expect(engine.repo.intakeItem({ ...oogie, bottleSize: 1000 }).result).toBe("created");
    expect(engine.repo.intakeItem({ ...oogie, packaging: "none" }).result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(4);
  });

  it("treats a numbered bottle, and any open bottle, as one specific object", () => {
    const numbered = { distillery: "Port Ellen", expression: "1979", bottleNumber: "Bottle 2417 of 5400" } as const;
    expect(engine.repo.intakeItem(numbered).result).toBe("created");
    expect(engine.repo.intakeItem(numbered).result).toBe("created");
    const batch = { ...oogie, bottleNumber: "Batch 12" };
    expect(engine.repo.intakeItem(batch).result).toBe("created");
    expect(engine.repo.intakeItem(batch).result).toBe("merged");
    expect(engine.repo.intakeItem({ ...oogie, sealed: false, fillLevel: 80 }).result).toBe("created");
    expect(engine.repo.intakeItem({ ...oogie, sealed: false, fillLevel: 80 }).result).toBe("created");
    const open = engine.repo.listItems().filter((b) => !b.sealed);
    expect(open).toHaveLength(2);
    expect(open.every((b) => b.quantity === 1)).toBe(true);
    expect(() => engine.repo.addAcquisition(open[0].id, { quantity: 1 })).toThrow(/one specific object/);
  });
});

describe("identification", () => {
  it("turns what the model read into a record and leaves the rest to the form", () => {
    const input = toInput({ confidence: 0.8, alternatives: [], distillery: "Ardbeg", expression: "Uigeadail", age_statement: null, vintage: null, bottling_year: 2023, cask_type: "bourbon and sherry casks", abv: 54.2, bottle_size: 700, bottle_number: "L2311", region: "islay", packaging: "tube", sealed: true, fill_level: null, condition_notes: null });
    expect(input).toMatchObject({ distillery: "Ardbeg", expression: "Uigeadail", bottlingYear: 2023, abv: 54.2, bottleSize: 700, bottleNumber: "L2311", region: "islay", packaging: "tube", sealed: true });
    const unsure = toInput({ confidence: 0.4, alternatives: [], distillery: "Ardbeg", expression: "10", age_statement: 10, sealed: null, packaging: null, bottle_size: null });
    expect(unsure.sealed).toBeUndefined();
    expect(unsure.packaging).toBeUndefined();
    expect(engine.repo.createItem(unsure)).toMatchObject({ sealed: true, packaging: "none", bottleSize: 700 });
  });
});

describe("the collection on disk", () => {
  it("mirrors an open bottle with what opening did to it", () => {
    engine.repo.createItem({ ...oogie, sealed: false, openedAt: "2025-12-25", fillLevel: 60, frozenValue: 92, location: "Trolley" });
    engine.mirror.flushCollection();
    const dir = engine.mirror.itemsDir();
    const text = fs.readFileSync(`${dir}/${fs.readdirSync(dir)[0]}`, "utf8");
    expect(text).toContain("# Ardbeg Uigeadail");
    expect(text).toContain("Open · 60% left");
    expect(text).toContain("Opened on 2025-12-25, 60% left. Value frozen at $92.00; not counted in the portfolio.");
    expect(text).toContain('opened_at: "2025-12-25"');
  });

  it("loads the sample shelf once, with sealed stacks and open bottles", () => {
    expect(loadSeed(engine)).toBe(spec.seed!.length);
    const items = engine.repo.listItems();
    expect(items.find((b) => b.distillery === "Springbank")?.quantity).toBe(3);
    const open = items.filter((b) => !b.sealed);
    expect(open).toHaveLength(2);
    expect(open.every((b) => b.frozenValue !== null && b.openedAt !== null)).toBe(true);
    const counted = items.filter((b) => engine.counts(b));
    expect(counted).toHaveLength(items.length - 2);
    const points = portfolioSeries(counted, engine.repo.allSnapshots());
    expect(points.length).toBeGreaterThan(3);
    expect(() => loadSeed(engine)).toThrow(/empty/);
  });
});
