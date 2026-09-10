import { beforeEach, describe, expect, it } from "vitest";
import { headerKey, parseCsv } from "@collectcollect/core/csv";
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

  it("reads grades however they are written, and only falls back to condition without a number", () => {
    const rows = previewImport(
      [
        "name,game,grading company,grade",
        "A,pokemon,PSA,9",
        "B,pokemon,,NM",
        "C,pokemon,,PSA 10",
        "D,pokemon,,Gem Mint 9.5",
        "E,pokemon,BGS,9.5",
      ].join("\n"),
    ).rows;
    expect(rows[0].input).toMatchObject({ gradingCompany: "PSA", grade: "9" });
    expect(rows[1].input).toMatchObject({ gradingCompany: null, grade: null, condition: "NM" });
    // A company embedded in the grade cell is recognised rather than dropped.
    expect(rows[2].input).toMatchObject({ gradingCompany: "PSA", grade: "10" });
    // No company named, but the grade is still a grade, not a condition.
    expect(rows[3].input).toMatchObject({ gradingCompany: null, grade: "9.5" });
    expect(rows[4].input).toMatchObject({ gradingCompany: "BGS", grade: "9.5" });
  });

  it("warns rather than silently calling an unknown condition near mint", () => {
    const [known, unknown] = previewImport(["name,game,condition", "A,pokemon,LP", "B,pokemon,Played"].join("\n")).rows;
    expect(known).toMatchObject({ warning: null });
    expect(known.input?.condition).toBe("LP");
    expect(unknown.input?.condition).toBe("NM");
    expect(unknown.warning).toMatch(/"Played" was not recognised/);
  });

  it("reports the line each row came from, even after blank ones", () => {
    const preview = previewImport(["name,game", "A,pokemon", "", "", "B,pokemon", ",pokemon"].join("\n"));
    expect(preview.rows.map((r) => r.line)).toEqual([2, 5, 6]);
    expect(preview.rows[2].problem).toMatch(/No card name/);
  });

  it("explains rows it cannot use", () => {
    const preview = previewImport(["name,game", ",pokemon", "Ok,pokemon", "NoGame,"].join("\n"));
    expect(preview.total).toBe(3);
    expect(preview.usable).toBe(1);
    expect(preview.rows[0].problem).toMatch(/No card name/);
    expect(preview.rows[2].problem).toMatch(/No game column/);
  });

  it("maps the column names people use for where a card is kept", () => {
    const rows = previewImport(["name,game,Storage Box", "A,pokemon,Binder 2"].join("\n")).rows;
    expect(rows[0].input?.location).toBe("Binder 2");
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

describe("spreadsheets from older tools", () => {
  it("reads a file whose rows end with a bare carriage return", () => {
    const csv = "name,set,quantity\rCharizard,Base Set,2\rBlastoise,Base Set,1";
    const preview = previewImport(csv, { game: "pokemon" });
    expect(preview.total).toBe(2);
    expect(preview.rows.map((r) => r.input?.name)).toEqual(["Charizard", "Blastoise"]);
  });

  it("does not read a currency symbol on its own as a price of zero", () => {
    const preview = previewImport("name,purchase price\nCharizard,$", { game: "pokemon" });
    expect(preview.rows[0].input?.purchasePrice).toBeNull();
    const withPrice = previewImport("name,purchase price\nCharizard,$12.50", { game: "pokemon" });
    expect(withPrice.rows[0].input?.purchasePrice).toBe(12.5);
  });
});

describe("rows an import cannot decide about", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("sets aside a row that matches more than one card you own", () => {
    createCard({ game: "pokemon", name: "Charizard" });
    createCard({ game: "pokemon", name: "Charizard" });
    const result = applyImport(previewImport("name,quantity\nCharizard,1\nBlastoise,1", { game: "pokemon" }));
    expect(result).toMatchObject({ created: 1, merged: 0 });
    expect(result.skipped).toEqual([{ line: 2, reason: "Charizard matches more than one card you own" }]);
    expect(listCards()).toHaveLength(3);
  });
});

