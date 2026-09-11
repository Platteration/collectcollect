import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { headerKey, parseCsv } from "@/lib/csv";
import { MAX_IMPORT_ROWS, applyImport, previewImport } from "@/lib/import";
import { createCard, findSimilar, listCards, updateCard } from "@/lib/cards";
import { getDb, openDatabase, setDb } from "@/lib/db";

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

/**
 * A CSV import is a synchronous loop inside the request handler, so whatever it
 * costs, the server answers nothing else for that long. Three things kept that
 * unbounded: no cap on rows, a duplicate lookup that scanned the whole cards
 * table per row because it filtered on an expression, and a transaction per
 * row. Twenty thousand rows — well inside the route's 8 MB body — blocked the
 * process for a minute, and the table it left behind made the next import
 * slower still.
 */
describe("what one import is allowed to cost", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("reads no more rows than the cap, and says how many it left", () => {
    const rows = MAX_IMPORT_ROWS + 25;
    const csv = ["name,game", ...Array.from({ length: rows }, (_, i) => `Card ${i},pokemon`)].join("\n");
    const preview = previewImport(csv);
    // Derived from the file, not from the constant: whatever the cap is, the
    // rows read plus the rows reported must account for every row in the file.
    expect(preview.rows.length + preview.skippedForSize).toBe(rows);
    expect(preview.skippedForSize).toBeGreaterThan(0);
    expect(preview.total).toBe(preview.rows.length);
    expect(applyImport(preview).created).toBe(preview.rows.length);
    // Writing a capped file's worth of cards is the slow half of this suite;
    // the point is that it finishes at all, not how fast.
  }, 60_000);

  it("leaves a file under the cap alone", () => {
    const csv = ["name,game", "Charizard,pokemon", "Blastoise,pokemon"].join("\n");
    expect(previewImport(csv).skippedForSize).toBe(0);
  });

  it("finds a duplicate through the index rather than by reading every card", () => {
    createCard({ game: "pokemon", name: "Charizard" });
    // SQLite's own plan, not a stopwatch: both columns have to be used, or the
    // lookup degrades to a scan of every card in that game once per row.
    const plan = getDb()
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM cards WHERE game = ? AND name_key = ? ORDER BY updated_at DESC")
      .all("pokemon", "charizard") as Array<{ detail: string }>;
    expect(plan.map((r) => r.detail).join(" ")).toMatch(/USING INDEX idx_cards_lookup \(game=\? AND name_key=\?\)/);
    expect(findSimilar({ game: "pokemon", name: " CHARIZARD " })).toHaveLength(1);
  });

  it("keeps the stored key in step with the name, including on a row that predates it", () => {
    const card = createCard({ game: "mtg", name: "Ragavan" });
    updateCard(card.id, { name: " Lightning Bolt " });
    expect(findSimilar({ game: "mtg", name: "lightning bolt" })).toHaveLength(1);
    expect(findSimilar({ game: "mtg", name: "Ragavan" })).toHaveLength(0);

    // A database written before the column existed: reopening backfills it.
    getDb().prepare("UPDATE cards SET name_key = NULL WHERE id = ?").run(card.id);
    expect(findSimilar({ game: "mtg", name: "lightning bolt" })).toHaveLength(0);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-import-")), "old.db");
    const fresh = openDatabase(file);
    fresh.prepare("INSERT INTO cards (game, name, quantity, condition, grading_status, external_ids, manual_graded, created_at, updated_at) VALUES ('mtg','Ragavan',1,'NM','undecided','{}','{}','t','t')").run();
    fresh.prepare("UPDATE cards SET name_key = NULL").run();
    fresh.close();
    setDb(openDatabase(file));
    expect(findSimilar({ game: "mtg", name: "ragavan" })).toHaveLength(1);
  });

  it("commits once for the whole file, not once per row", () => {
    const db = openDatabase(":memory:");
    const real = db.transaction.bind(db);
    let topLevel = 0;
    db.transaction = ((fn: () => unknown) => {
      const wrapped = real(fn);
      return (...args: unknown[]) => {
        const outermost = !db.inTransaction;
        const out = (wrapped as (...a: unknown[]) => unknown)(...args);
        if (outermost) topLevel += 1;
        return out;
      };
    }) as typeof db.transaction;
    setDb(db);

    const csv = ["name,game", ...Array.from({ length: 20 }, (_, i) => `Card ${i},pokemon`)].join("\n");
    expect(applyImport(previewImport(csv)).created).toBe(20);
    // Twenty cards, one commit: intakeCard's own transaction nests as a savepoint.
    expect(topLevel).toBe(1);
  });
});
