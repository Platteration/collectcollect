import { beforeEach, describe, expect, it } from "vitest";
import { headerKey, parseCsv } from "@/lib/csv";
import { applyImport, previewImport } from "@/lib/import";
import { createCard, listCards } from "@/lib/cards";
import { openDatabase, setDb } from "@/lib/db";

describe("csv parsing", () => {
  it("handles quotes, embedded separators and both line endings", () => {
    const text = 'a,b,c\r\n1,"two, still two","he said ""hi"""\r\n3,"line\nbreak",\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "two, still two", 'he said "hi"'],
      ["3", "line\nbreak", ""],
    ]);
  });

  it("ignores a byte-order mark and a missing final newline", () => {
    expect(parseCsv("﻿name,qty\nPikachu,2")).toEqual([
      ["name", "qty"],
      ["Pikachu", "2"],
    ]);
    expect(parseCsv("")).toEqual([]);
  });

  it("normalizes headers for matching", () => {
    expect(headerKey(" Card Number ")).toBe("cardnumber");
    expect(headerKey("Purchase_Price ($)")).toBe("purchaseprice");
  });
});

describe("import preview", () => {
  it("maps the columns other tools use and reports the rest", () => {
    const csv = ["Card Name,Game,Edition,Card Number,Qty,Cond,Price Paid,Sleeve", 'Charizard,Pokemon,Base Set,4/102,2,NM,"$400.00",yes'].join("\n");
    const preview = previewImport(csv);
    expect(preview.mapping).toMatchObject({ name: "Card Name", setName: "Edition", cardNumber: "Card Number", quantity: "Qty", purchasePrice: "Price Paid" });
    expect(preview.unmapped).toEqual(["Sleeve"]);
    expect(preview.rows[0].input).toMatchObject({
      game: "pokemon",
      name: "Charizard",
      setName: "Base Set",
      cardNumber: "4/102",
      quantity: 2,
      condition: "NM",
      purchasePrice: 400,
    });
  });

  it("understands the game and condition names people actually write", () => {
    const rows = previewImport(
      ["name,game,condition", "A,Yu-Gi-Oh!,Lightly Played", "B,MAGIC,VG", "C,baseball,Damaged", "D,Pokémon,"].join("\n"),
    ).rows;
    expect(rows.map((r) => r.input?.game)).toEqual(["yugioh", "mtg", "sports", "pokemon"]);
    expect(rows.map((r) => r.input?.condition)).toEqual(["LP", "MP", "DMG", "NM"]);
  });

  it("treats a grade column holding a condition as a condition, not a grade", () => {
    const [graded, raw] = previewImport(["name,game,grading company,grade", "A,pokemon,PSA,9", "B,pokemon,,NM"].join("\n")).rows;
    expect(graded.input).toMatchObject({ gradingCompany: "PSA", grade: "9" });
    expect(raw.input).toMatchObject({ gradingCompany: null, grade: null, condition: "NM" });
  });

  it("explains rows it cannot use", () => {
    const preview = previewImport(["name,game", ",pokemon", "Ok,pokemon", "NoGame,"].join("\n"));
    expect(preview.total).toBe(3);
    expect(preview.usable).toBe(1);
    expect(preview.rows[0].problem).toMatch(/No card name/);
    expect(preview.rows[2].problem).toMatch(/No game column/);
  });

  it("applies a chosen game when the file has no game column", () => {
    const preview = previewImport(["name,set", "Pikachu,Jungle"].join("\n"), { game: "pokemon" });
    expect(preview.rows[0].input).toMatchObject({ game: "pokemon", setName: "Jungle" });
  });
});

describe("applying an import", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("creates new cards and merges into ones already owned", () => {
    createCard({ game: "pokemon", name: "Pikachu", setName: "Jungle", cardNumber: "60/64" });
    const preview = previewImport(
      ["name,game,set,number,qty", "Pikachu,pokemon,Jungle,60/64,2", "Charizard,pokemon,Base Set,4/102,1", ",pokemon,,,1"].join("\n"),
    );
    const result = applyImport(preview);
    expect(result).toMatchObject({ created: 1, merged: 1 });
    expect(result.skipped[0]).toMatchObject({ line: 4 });
    const pikachu = listCards().find((c) => c.name === "Pikachu");
    expect(pikachu?.quantity).toBe(3); // the one owned plus the two imported
  });

  it("round-trips this app's own export format", () => {
    createCard({ game: "sports", sport: "baseball", name: "Mike Trout", setName: "Topps Update", cardNumber: "US175", year: 2011, quantity: 2, purchasePrice: 650 });
    const header = "id,game,sport,name,set,set_code,number,year,rarity,variant,language,manufacturer,quantity,condition,grading_company,grade,cert_number,grading_status,purchase_price";
    const row = "1,Sports,baseball,Mike Trout,Topps Update,,US175,2011,,,,,2,NM,,,,undecided,650";
    setDb(openDatabase(":memory:"));
    const result = applyImport(previewImport([header, row].join("\r\n")));
    expect(result.created).toBe(1);
    expect(listCards()[0]).toMatchObject({ game: "sports", name: "Mike Trout", cardNumber: "US175", year: 2011, quantity: 2, purchasePrice: 650 });
  });
});
