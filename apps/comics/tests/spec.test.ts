import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { toInput } from "@/lib/identify";
import { spec } from "@/lib/spec";
import { normalizeCoverDate } from "@/lib/types";
import { loadSeed } from "@collectcollect/core/domain/seed";
import { portfolioSeries } from "@collectcollect/core/domain/analytics";

const asm300 = { title: "The Amazing Spider-Man", publisher: "Marvel", issueNumber: "300", volume: 1, coverDate: "1988-05", grade: "9.2" } as const;

describe("the comic schema", () => {
  it("needs a title and an issue number", () => {
    expect(() => engine.repo.normalize({ issueNumber: "1" })).toThrow(/Title/);
    expect(() => engine.repo.normalize({ title: "Saga" })).toThrow(/Issue/);
  });

  it("reads a cover date however it is written", () => {
    expect(normalizeCoverDate("1988-05")).toBe("1988-05");
    expect(normalizeCoverDate("May 1988")).toBe("1988-05");
    expect(normalizeCoverDate("5/1988")).toBe("1988-05");
    expect(normalizeCoverDate("1988")).toBe("1988");
    expect(normalizeCoverDate("1988-05-01")).toBe("1988-05");
    expect(normalizeCoverDate("sometime")).toBeNull();
    expect(engine.repo.normalize({ title: "Saga", issueNumber: "1", coverDate: "Mar 2012" }).coverDate).toBe("2012-03");
    expect(() => engine.repo.normalize({ title: "Saga", issueNumber: "1", coverDate: "the nineties" })).toThrow(/Cover date/);
  });

  it("only takes key flags it knows, by id, label or the words people use", () => {
    expect(engine.repo.normalize({ title: "Saga", issueNumber: "1", keyFlags: ["first_issue", "First appearance", "1st app"] as never }).keyFlags).toEqual(["first_issue", "first_appearance"]);
    expect(() => engine.repo.normalize({ title: "Saga", issueNumber: "1", keyFlags: ["shiny"] as never })).toThrow(/key issue/i);
  });

  it("insists a slab says who graded it and what they said, and clears those fields on a raw copy", () => {
    expect(() => engine.repo.normalize({ ...asm300, slabbed: true })).toThrow(/company/);
    expect(() => engine.repo.normalize({ ...asm300, slabbed: true, gradingCompany: "cgc", grade: null })).toThrow(/grade/);
    const raw = engine.repo.normalize({ ...asm300, slabbed: false, gradingCompany: "cgc", certNumber: "123" });
    expect(raw).toMatchObject({ gradingCompany: "none", certNumber: null, grade: "9.2" });
    expect(() => engine.repo.normalize({ ...asm300, grade: "mint" })).toThrow(/10-point/);
  });

  it("reads the words a spreadsheet uses", () => {
    const preview = engine.csv.previewImport(["series,#,pub,date,key,of,graded,grader,cgc grade,cert,pq,ss,paid", "Amazing Spider-Man,300,Marvel,May 1988,1st app; classic cover,Venom,yes,CGC,9.4,2036123-004,OWW,no,900"].join("\n"));
    expect(preview.usable).toBe(1);
    expect(preview.rows[0].input).toMatchObject({ title: "Amazing Spider-Man", issueNumber: "300", publisher: "Marvel", coverDate: "May 1988", keyFlags: ["first_appearance", "classic_cover"], keyOf: "Venom", slabbed: true, gradingCompany: "cgc", grade: "9.4", certNumber: "2036123-004", pageQuality: "off_white_to_white", signatureSeries: false, purchasePrice: 900 });
    const result = engine.csv.applyImport(preview);
    expect(result.created).toBe(1);
    expect(engine.repo.listItems()[0].coverDate).toBe("1988-05");
  });
});

describe("one specific object, or a stack", () => {
  it("stacks raw copies of the same issue at the same estimated grade", () => {
    expect(engine.repo.intakeItem({ ...asm300, purchasePrice: 400 }).result).toBe("created");
    expect(engine.repo.intakeItem({ ...asm300, purchasePrice: 450 }).result).toBe("merged");
    const [item] = engine.repo.listItems();
    expect(item.quantity).toBe(2);
    expect(engine.ledger.listLots(item.id).map((l) => l.unitCost)).toEqual([400, 450]);
  });

  it("keeps a different grade, printing or signature apart", () => {
    engine.repo.intakeItem(asm300);
    expect(engine.repo.intakeItem({ ...asm300, grade: "6.0" }).result).toBe("created");
    expect(engine.repo.intakeItem({ ...asm300, variant: "Newsstand" }).result).toBe("created");
    expect(engine.repo.intakeItem({ ...asm300, signatureSeries: true }).result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(4);
  });

  it("never merges slabs", () => {
    const slab = { ...asm300, slabbed: true, gradingCompany: "cgc", grade: "9.4", certNumber: "2036123-004" } as const;
    expect(engine.repo.intakeItem(slab).result).toBe("created");
    expect(engine.repo.intakeItem(slab).result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(2);
    expect(() => engine.repo.addAcquisition(engine.repo.listItems()[0].id, { quantity: 1 })).toThrow(/one specific object/);
  });
});

describe("identification", () => {
  it("turns what the model read into a record", () => {
    const input = toInput({
      confidence: 0.9,
      alternatives: [],
      title: "The Amazing Spider-Man",
      publisher: "Marvel",
      issue_number: "300",
      volume: 1,
      cover_date: "May 1988",
      variant: null,
      key_issue_flags: ["first_appearance", "not_a_flag"],
      key_of: "Venom",
      slabbed: true,
      grading: { company: "cgc", grade: "9.4", cert_number: "2036123-004", page_quality: "white", signature_series: false },
      condition_notes: null,
    });
    expect(input).toMatchObject({ title: "The Amazing Spider-Man", issueNumber: "300", coverDate: "1988-05", keyFlags: ["first_appearance"], keyOf: "Venom", slabbed: true, gradingCompany: "cgc", grade: "9.4", certNumber: "2036123-004", pageQuality: "white" });
    const item = engine.repo.createItem(input);
    expect(spec.title(item)).toBe("The Amazing Spider-Man #300");
    expect(spec.conditionLabel(item)).toBe("CGC 9.4");
  });

  it("treats a label with a company as slabbed even if the flag was missed, and a raw copy as raw", () => {
    expect(toInput({ confidence: 0.5, alternatives: [], title: "Saga", issue_number: "1", slabbed: false, grading: { company: "cbcs", grade: "9.8", cert_number: "19-2C4E7A1B-001", page_quality: null, signature_series: true } })).toMatchObject({ slabbed: true, gradingCompany: "cbcs", signatureSeries: true });
    expect(toInput({ confidence: 0.5, alternatives: [], title: "Saga", issue_number: "1", slabbed: false, grading: { company: null, grade: "9.0", cert_number: "x", page_quality: null, signature_series: false } })).toMatchObject({ slabbed: false, gradingCompany: "none", certNumber: null, grade: "9.0" });
  });
});

describe("the collection on disk", () => {
  it("mirrors every comic to Markdown with its key issue named", () => {
    engine.repo.createItem({ ...asm300, keyFlags: ["first_appearance"], keyOf: "Venom", location: "Safe" });
    engine.mirror.flushCollection();
    const dir = engine.mirror.itemsDir();
    const file = fs.readdirSync(dir).find((f) => f.includes("amazing-spider-man"));
    expect(file).toBeDefined();
    const text = fs.readFileSync(`${dir}/${file}`, "utf8");
    expect(text).toContain("# The Amazing Spider-Man #300");
    expect(text).toContain("First appearance");
    expect(text).toContain("Raw 9.2");
    const index = fs.readFileSync(`${engine.mirror.collectionDir()}/index.md`, "utf8");
    expect(index).toContain("| Publisher | Key |");
    expect(index).toContain("First appearance");
  });

  it("loads the sample long box once, with a history to draw", () => {
    expect(loadSeed(engine)).toBe(spec.seed!.length);
    const items = engine.repo.listItems();
    expect(items.filter((i) => i.slabbed)).toHaveLength(3);
    expect(items.find((i) => i.issueNumber === "1" && i.title === "X-Men")?.quantity).toBe(3);
    const points = portfolioSeries(items, engine.repo.allSnapshots());
    expect(points.length).toBeGreaterThan(3);
    expect(() => loadSeed(engine)).toThrow(/empty/);
  });
});
