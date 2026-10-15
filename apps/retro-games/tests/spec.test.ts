import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { toInput } from "@/lib/identify";
import { spec } from "@/lib/spec";
import { loadSeed } from "@collectcollect/core/domain/seed";
import { portfolioSeries } from "@collectcollect/core/domain/analytics";

const mario = { title: "Super Mario 64", platform: "n64", region: "ntsc_u", releaseYear: 1996, completeness: "cib", boxCondition: "very_good", manualCondition: "near_mint", mediaCondition: "near_mint" } as const;

describe("the game schema", () => {
  it("needs a title and a platform it knows", () => {
    expect(() => engine.repo.normalize({ platform: "n64" })).toThrow(/Title/);
    expect(() => engine.repo.normalize({ title: "Tetris", platform: "gameboi" as never })).toThrow(/platform/i);
  });

  it("defaults a bare record to a loose NTSC-U copy", () => {
    const clean = engine.repo.normalize({ title: "Tetris", platform: "game_boy" });
    expect(clean).toMatchObject({ region: "ntsc_u", completeness: "loose", gradingCompany: "none", grade: null, certNumber: null, boxCondition: null, manualCondition: null });
  });

  it("insists a graded copy says who graded it and what they said", () => {
    expect(() => engine.repo.normalize({ title: "Tetris", platform: "game_boy", completeness: "graded" })).toThrow(/grade/);
    expect(() => engine.repo.normalize({ title: "Tetris", platform: "game_boy", completeness: "graded", grade: "9.4 A+" })).toThrow(/company/);
    const clean = engine.repo.normalize({ title: "Tetris", platform: "game_boy", completeness: "graded", grade: "9.4 A+", gradingCompany: "wata" });
    expect(clean.gradingCompany).toBe("wata");
  });

  it("clears the fields a completeness cannot have", () => {
    const loose = engine.repo.normalize({ title: "Tetris", platform: "game_boy", completeness: "loose", boxCondition: "mint", manualCondition: "mint", gradingCompany: "wata", grade: "9.8", certNumber: "x" });
    expect(loose).toMatchObject({ boxCondition: null, manualCondition: null, gradingCompany: "none", grade: null, certNumber: null });
    const sealed = engine.repo.normalize({ title: "Tetris", platform: "game_boy", completeness: "sealed", boxCondition: "mint", manualCondition: "mint", mediaCondition: "mint" });
    expect(sealed).toMatchObject({ boxCondition: "mint", manualCondition: null, mediaCondition: null });
  });

  it("marks the fields the collection page can search and filter on", () => {
    const by = (key: string) => spec.fields.find((f) => f.key === key)!;
    expect(by("title").searchable).toBe(true);
    expect(by("platform").filterable).toBe(true);
    expect(by("region").filterable).toBe(true);
    expect(by("completeness").filterable).toBe(true);
  });

  it("reads the words a spreadsheet uses for regions, completeness and conditions", () => {
    const preview = engine.csv.previewImport(["title,system,region,complete,box,cart,paid", "Super Mario 64,Nintendo 64,USA,Complete,VG,NM,45"].join("\n"));
    expect(preview.usable).toBe(1);
    expect(preview.rows[0].input).toMatchObject({ title: "Super Mario 64", platform: "n64", region: "ntsc_u", completeness: "cib", boxCondition: "very_good", mediaCondition: "near_mint", purchasePrice: 45 });
  });
});

describe("one specific object, or a stack", () => {
  it("stacks identical loose or complete copies", () => {
    const a = engine.repo.intakeItem({ ...mario, purchasePrice: 45 });
    const b = engine.repo.intakeItem({ ...mario, purchasePrice: 60 });
    expect(a.result).toBe("created");
    expect(b.result).toBe("merged");
    const [item] = engine.repo.listItems();
    expect(engine.repo.listItems()).toHaveLength(1);
    expect(item.quantity).toBe(2);
    // Two purchases at two prices, kept apart in the ledger.
    expect(engine.ledger.listLots(item.id).map((l) => l.unitCost)).toEqual([45, 60]);
  });

  it("keeps copies apart when their condition differs", () => {
    engine.repo.intakeItem(mario);
    const worse = engine.repo.intakeItem({ ...mario, boxCondition: "poor" });
    expect(worse.result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(2);
  });

  it("keeps a sealed copy apart from a complete one, and a PAL copy from a US one", () => {
    engine.repo.intakeItem(mario);
    expect(engine.repo.intakeItem({ ...mario, completeness: "sealed", boxCondition: "very_good" }).result).toBe("created");
    expect(engine.repo.intakeItem({ ...mario, region: "pal" }).result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(3);
  });

  it("never merges graded copies, even with the same cert", () => {
    const slab = { ...mario, completeness: "graded", gradingCompany: "wata", grade: "9.4 A+", certNumber: "0921347001" } as const;
    expect(engine.repo.intakeItem(slab).result).toBe("created");
    expect(engine.repo.intakeItem(slab).result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(2);
    expect(engine.repo.listItems().every((i) => i.quantity === 1)).toBe(true);
    expect(() => engine.repo.addAcquisition(engine.repo.listItems()[0].id, { quantity: 1 })).toThrow(/one specific object/);
  });
});

describe("identification", () => {
  it("turns what the model read into a record, dropping what it could not tell", () => {
    const input = toInput({
      confidence: 0.8,
      alternatives: [],
      title: "Chrono Trigger",
      platform: "snes",
      region: null,
      release_year: 1995,
      publisher: "Square",
      completeness: "graded",
      grading: { company: "wata", grade: "9.6 A++", cert_number: "12345" },
      box_condition: "near_mint",
      manual_condition: null,
      media_condition: "nope",
      variant: null,
      condition_notes: "Light shelf wear.",
    });
    expect(input).toMatchObject({ title: "Chrono Trigger", platform: "snes", releaseYear: 1995, completeness: "graded", gradingCompany: "wata", grade: "9.6 A++", certNumber: "12345", boxCondition: "near_mint", mediaCondition: null, notes: "Light shelf wear." });
    expect(input.region).toBeUndefined();
    // Saved through the schema, the record is valid.
    const item = engine.repo.createItem(input);
    expect(item.region).toBe("ntsc_u");
    expect(spec.conditionLabel(item)).toBe("WATA 9.6 A++");
  });
});

describe("the collection on disk", () => {
  it("mirrors every game to Markdown with its platform and region", () => {
    const item = engine.repo.createItem({ ...mario, location: "Shelf A" });
    engine.mirror.flushCollection();
    const dir = engine.mirror.itemsDir();
    const file = fs.readdirSync(dir).find((f) => f.includes("super-mario-64"));
    expect(file).toBeDefined();
    const text = fs.readFileSync(`${dir}/${file}`, "utf8");
    expect(text).toContain('platform: "n64"');
    expect(text).toContain("Nintendo 64 · NTSC-U · 1996");
    expect(text).toContain("Complete in box");
    expect(item.id).toBe(1);
  });

  it("loads the sample shelf once, with a history to draw", () => {
    expect(loadSeed(engine)).toBe(spec.seed!.length);
    const items = engine.repo.listItems();
    expect(items.length).toBe(spec.seed!.length);
    expect(items.some((i) => i.completeness === "graded")).toBe(true);
    expect(items.find((i) => i.title === "Sonic the Hedgehog 2")?.quantity).toBe(3);
    const points = portfolioSeries(items, engine.repo.allSnapshots());
    expect(points.length).toBeGreaterThan(3);
    expect(points[points.length - 1].value).toBeGreaterThan(points[0].value);
    expect(() => loadSeed(engine)).toThrow(/empty/);
  });
});
