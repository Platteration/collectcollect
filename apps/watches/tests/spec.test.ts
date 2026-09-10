import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { toInput } from "@/lib/identify";
import { spec } from "@/lib/spec";
import { cleanServiceHistory } from "@/lib/types";
import { loadSeed } from "@collectcollect/core/domain/seed";
import { portfolioSeries } from "@collectcollect/core/domain/analytics";

const speedy = { brand: "Omega", model: "Speedmaster Professional", referenceNumber: "310.30.42.50.01.001", serialNumber: "88 412 553", movement: "manual", caseSize: 42, caseMaterial: "steel", year: 2023, boxPapers: "both", condition: "excellent" } as const;

describe("the watch schema", () => {
  it("needs a brand and a model", () => {
    expect(() => engine.repo.normalize({ model: "Speedmaster" })).toThrow(/Brand/);
    expect(() => engine.repo.normalize({ brand: "Omega" })).toThrow(/Model/);
  });

  it("checks the case size, the year and the enum fields", () => {
    expect(() => engine.repo.normalize({ brand: "Omega", model: "X", caseSize: 4 })).toThrow(/Case size/);
    expect(() => engine.repo.normalize({ brand: "Omega", model: "X", year: 1700 })).toThrow(/Year/);
    expect(() => engine.repo.normalize({ brand: "Omega", model: "X", movement: "steam" as never })).toThrow(/movement/i);
    expect(engine.repo.normalize({ brand: "Omega", model: "X" })).toMatchObject({ boxPapers: "neither", condition: "good", serviceHistory: [], quantity: 1 });
  });

  it("keeps the serial number private and the service log out of the generic form", () => {
    const serial = spec.fields.find((f) => f.key === "serialNumber")!;
    expect(serial.private).toBe(true);
    expect(spec.fields.find((f) => f.key === "serviceHistory")?.hidden).toBe(true);
    expect(spec.report.columns.find((c) => c.header === "Serial")?.private).toBe(true);
  });

  it("reads a service history however it arrives, and insists on dates and notes", () => {
    expect(cleanServiceHistory(null)).toEqual([]);
    expect(cleanServiceHistory([{ date: "2024-05-01", notes: "Full service" }, { date: "2021-01-15T00:00:00.000Z", notes: "Crystal" }])).toEqual([
      { date: "2021-01-15", notes: "Crystal" },
      { date: "2024-05-01", notes: "Full service" },
    ]);
    expect(cleanServiceHistory("2021-03-04: Full service; 2024-01-10 - Crystal replaced")).toEqual([
      { date: "2021-03-04", notes: "Full service" },
      { date: "2024-01-10", notes: "Crystal replaced" },
    ]);
    expect(() => cleanServiceHistory([{ date: "soon", notes: "x" }])).toThrow(/date/);
    expect(() => cleanServiceHistory([{ date: "2024-05-01", notes: " " }])).toThrow(/note/);
    expect(() => cleanServiceHistory("not a log")).toThrow(/date/);
  });

  it("reads the words a spreadsheet uses", () => {
    const preview = engine.csv.previewImport(["make,name,ref,serial,winding,material,box papers,condition,paid,service", "Rolex,Submariner,124060,7K2R4X81,auto,SS,full set,LNIB,9100,2024-02-02: Pressure test"].join("\n"));
    expect(preview.usable).toBe(1);
    expect(preview.rows[0].input).toMatchObject({ brand: "Rolex", model: "Submariner", referenceNumber: "124060", serialNumber: "7K2R4X81", movement: "automatic", caseMaterial: "steel", boxPapers: "both", condition: "excellent", purchasePrice: 9100 });
    engine.csv.applyImport(preview);
    expect(engine.repo.listItems()[0].serviceHistory).toEqual([{ date: "2024-02-02", notes: "Pressure test" }]);
  });
});

describe("one specific object, always", () => {
  it("never stacks two of the same reference, even with the same serial typed twice", () => {
    expect(engine.repo.intakeItem(speedy).result).toBe("created");
    expect(engine.repo.intakeItem(speedy).result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(2);
    expect(engine.repo.listItems().every((w) => w.quantity === 1)).toBe(true);
    expect(() => engine.repo.addAcquisition(engine.repo.listItems()[0].id, { quantity: 1 })).toThrow(/one specific object/);
    expect(engine.repo.createItem({ ...speedy, quantity: 3 }).quantity).toBe(1);
  });
});

describe("the service log on the page", () => {
  it("is appended to and taken back through an ordinary update", () => {
    const watch = engine.repo.createItem(speedy);
    const once = engine.repo.updateItem(watch.id, { serviceHistory: [{ date: "2024-05-01", notes: "Full service at Omega" }] })!;
    expect(once.serviceHistory).toEqual([{ date: "2024-05-01", notes: "Full service at Omega" }]);
    const twice = engine.repo.updateItem(watch.id, { serviceHistory: [...once.serviceHistory!, { date: "2022-01-01", notes: "Strap changed" }] })!;
    expect(twice.serviceHistory!.map((e) => e.date)).toEqual(["2022-01-01", "2024-05-01"]);
    // Editing something else leaves the log alone.
    expect(engine.repo.updateItem(watch.id, { dial: "black" })!.serviceHistory).toHaveLength(2);
  });
});

describe("identification", () => {
  it("turns what the model read into a record and leaves the rest to the form", () => {
    const input = toInput({ confidence: 0.7, alternatives: [], brand: "Omega", model: "Speedmaster Professional", reference_number: null, serial_number: null, movement: "manual", caliber: "3861", case_size: 42, case_material: "steel", dial: "black", bracelet_strap: "steel bracelet", year: null, box_papers: null, condition: "excellent", condition_notes: "Hairlines on the clasp." });
    expect(input).toMatchObject({ brand: "Omega", model: "Speedmaster Professional", referenceNumber: null, movement: "manual", caliber: "3861", caseSize: 42, caseMaterial: "steel", condition: "excellent", notes: "Hairlines on the clasp." });
    expect(input.boxPapers).toBeUndefined();
    const item = engine.repo.createItem(input);
    expect(item.boxPapers).toBe("neither");
    expect(spec.title(item)).toBe("Omega Speedmaster Professional");
  });
});

describe("the collection on disk and in the exports", () => {
  it("keeps the serial number out of the Markdown copy and the CSV until the owner opts in", () => {
    const watch = engine.repo.createItem({ ...speedy, serviceHistory: [{ date: "2024-05-01", notes: "Full service at Omega | Bienne" }] });
    engine.mirror.flushCollection();
    const dir = engine.mirror.itemsDir();
    const file = () => fs.readFileSync(`${dir}/${fs.readdirSync(dir).find((f) => f.includes("omega"))}`, "utf8");
    expect(file()).toContain("# Omega Speedmaster Professional");
    expect(file()).toContain("| 2024-05-01 | Full service at Omega \\| Bienne |");
    expect(file()).toContain('reference_number: "310.30.42.50.01.001"');
    expect(file()).not.toContain("88 412 553");
    expect(engine.exportCsv()).not.toContain("88 412 553");

    engine.settings.saveSettings({ exportPrivateFields: true });
    engine.repo.refreshMirror(watch.id);
    engine.mirror.flushCollection();
    expect(file()).toContain('serial_number: "88 412 553"');
    expect(engine.exportCsv()).toContain("88 412 553");
  });

  it("loads the sample box once, with a history to draw and a service log or two", () => {
    expect(loadSeed(engine)).toBe(spec.seed!.length);
    const items = engine.repo.listItems();
    expect(items.every((w) => w.quantity === 1)).toBe(true);
    expect(items.filter((w) => (w.serviceHistory?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
    const points = portfolioSeries(items, engine.repo.allSnapshots());
    expect(points.length).toBeGreaterThan(3);
    expect(points[points.length - 1].value).toBeGreaterThan(30000);
    expect(() => loadSeed(engine)).toThrow(/empty/);
  });
});
