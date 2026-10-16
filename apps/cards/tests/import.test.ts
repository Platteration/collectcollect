import { beforeEach, describe, expect, it } from "vitest";
import { headerKey, parseCsv } from "@collectcollect/core/csv";
import { MAX_IMPORT_ROWS, applyImport, previewImport } from "@/lib/import";
import { createCard, findSimilar, listCards } from "@/lib/cards";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { verifyLotInvariant } from "@/lib/acquisitions";
import { POST, forgetAppliedImports, throttle } from "@/app/api/import/route";

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
    expect(preview.rows[0]?.input).toMatchObject({
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
    expect(rows[0]?.input).toMatchObject({ gradingCompany: "PSA", grade: "9" });
    expect(rows[1]?.input).toMatchObject({ gradingCompany: null, grade: null, condition: "NM" });
    // A company embedded in the grade cell is recognised rather than dropped.
    expect(rows[2]?.input).toMatchObject({ gradingCompany: "PSA", grade: "10" });
    // No company named, but the grade is still a grade, not a condition.
    expect(rows[3]?.input).toMatchObject({ gradingCompany: null, grade: "9.5" });
    expect(rows[4]?.input).toMatchObject({ gradingCompany: "BGS", grade: "9.5" });
  });

  it("warns rather than silently calling an unknown condition near mint", () => {
    const [known, unknown] = previewImport(["name,game,condition", "A,pokemon,LP", "B,pokemon,Played"].join("\n")).rows;
    expect(known).toMatchObject({ warning: null });
    expect(known?.input?.condition).toBe("LP");
    expect(unknown?.input?.condition).toBe("NM");
    expect(unknown?.warning).toMatch(/"Played" was not recognised/);
  });

  it("reports the line each row came from, even after blank ones", () => {
    const preview = previewImport(["name,game", "A,pokemon", "", "", "B,pokemon", ",pokemon"].join("\n"));
    expect(preview.rows.map((r) => r.line)).toEqual([2, 5, 6]);
    expect(preview.rows[2]?.problem).toMatch(/No card name/);
  });

  it("explains rows it cannot use", () => {
    const preview = previewImport(["name,game", ",pokemon", "Ok,pokemon", "NoGame,"].join("\n"));
    expect(preview.total).toBe(3);
    expect(preview.usable).toBe(1);
    expect(preview.rows[0]?.problem).toMatch(/No card name/);
    expect(preview.rows[2]?.problem).toMatch(/No game column/);
  });

  it("maps the column names people use for where a card is kept", () => {
    const rows = previewImport(["name,game,Storage Box", "A,pokemon,Binder 2"].join("\n")).rows;
    expect(rows[0]?.input?.location).toBe("Binder 2");
  });

  it("applies a chosen game when the file has no game column", () => {
    const preview = previewImport(["name,set", "Pikachu,Jungle"].join("\n"), { game: "pokemon" });
    expect(preview.rows[0]?.input).toMatchObject({ game: "pokemon", setName: "Jungle" });
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

  it("takes the nine good rows of a file whose tenth is refused, in one transaction", () => {
    const lines = Array.from({ length: 9 }, (_, i) => `Card ${i},pokemon,1,${i + 1}`);
    // A count the repository refuses; the preview cannot know that yet.
    const result = applyImport(previewImport(["name,game,qty,cost", ...lines, "Bad Card,pokemon,5000000,1"].join("\n")));
    expect(result.created).toBe(9);
    expect(result.skipped).toEqual([{ line: 11, reason: expect.stringMatching(/larger than anything/) }]);
    expect(listCards()).toHaveLength(9);
    expect(verifyLotInvariant()).toEqual([]);
  });

  it("only applies what was previewed, and not the same file twice", async () => {
    forgetAppliedImports();
    throttle.reset();
    const post = (body: Record<string, unknown>) =>
      POST(new Request("http://localhost/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const csv = "name,game,qty\nSnorlax,pokemon,2";
    const { preview } = (await (await post({ csv })).json()) as { preview: { token: string } };
    expect((await post({ csv: "name,game,qty\nSnorlax,pokemon,20", apply: true, token: preview.token })).status).toBe(409);
    expect((await post({ csv, apply: true, token: preview.token })).status).toBe(200);
    const again = await post({ csv, apply: true, token: preview.token });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/imported a moment ago/);
    expect(listCards().map((c) => c.quantity)).toEqual([2]);
    // Looking at the file again and asking for it is a second import meant.
    expect((await post({ csv })).status).toBe(200);
    expect((await post({ csv, apply: true, token: preview.token })).status).toBe(200);
    expect(listCards().map((c) => c.quantity)).toEqual([4]);
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
    expect(preview.rows[0]?.input?.purchasePrice).toBeNull();
    const withPrice = previewImport("name,purchase price\nCharizard,$12.50", { game: "pokemon" });
    expect(withPrice.rows[0]?.input?.purchasePrice).toBe(12.5);
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


describe("a file larger than one import", () => {
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
  }, 120_000);

  it("leaves a file under the cap alone", () => {
    const csv = ["name,game", "Charizard,pokemon", "Blastoise,pokemon"].join("\n");
    expect(previewImport(csv).skippedForSize).toBe(0);
  });

  it("finds a duplicate through the index rather than by reading every card", () => {
    createCard({ game: "pokemon", name: "Charizard" });
    // SQLite's own plan, not a stopwatch: both columns have to be used, or the
    // lookup degrades to a scan of every card in that game once per row.
    const plan = getDb()
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM cards WHERE game = ? AND name_key = ? ORDER BY updated_at DESC, id DESC")
      .all("pokemon", "charizard") as Array<{ detail: string }>;
    expect(plan.map((r) => r.detail).join(" ")).toMatch(/USING INDEX idx_cards_lookup \(game=\? AND name_key=\?\)/);
    expect(findSimilar({ game: "pokemon", name: " CHARIZARD " })).toHaveLength(1);
  });
});

describe("sports columns", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("reads the team, rookie and parallel columns, the serial numbering, the flags and BGS subgrades", () => {
    const csv = [
      "player,sport,year,brand,set,number,team,RC,parallel,serial,auto,relic,grading company,grade,cert,centering,corners,edges,surface,paid",
      "Mike Trout,baseball,2011,Topps,Topps Chrome,US175,Los Angeles Angels,yes,Gold Refractor,12/50,x,,BGS,9.5,0012345678,9.5,9.5,10,9,650",
    ].join("\n");
    const preview = previewImport(csv);
    expect(preview.unmapped).toEqual([]);
    expect(preview.rows[0]?.input).toMatchObject({
      game: "sports",
      name: "Mike Trout",
      team: "Los Angeles Angels",
      rookie: true,
      parallel: "Gold Refractor",
      serialNumber: "12/50",
      autograph: true,
      relic: false,
      gradingCompany: "BGS",
      grade: "9.5",
      certNumber: "0012345678",
      subgrades: { centering: 9.5, corners: 9.5, edges: 10, surface: 9 },
    });
    expect(applyImport(preview)).toMatchObject({ created: 1, merged: 0 });
    expect(listCards()[0]).toMatchObject({ serialNumber: "12/50", subgrades: { edges: 10 } });
  });

  it("no longer reads a serial column as a cert number, and a parallel column as a variant", () => {
    const preview = previewImport(["name,game,serial,parallel", "Mike Trout,sports,7/25,Silver Prizm"].join("\n"));
    expect(preview.rows[0]?.input).toMatchObject({ serialNumber: "7/25", parallel: "Silver Prizm", certNumber: null, variant: null });
    // A cert column is still the cert.
    expect(previewImport(["name,game,cert", "Mike Trout,sports,0012345678"].join("\n")).rows[0]?.input).toMatchObject({ certNumber: "0012345678", serialNumber: null });
  });

  it("settles a row's game from its sport only when the row names no game", () => {
    const preview = previewImport(["name,sport,game", "Mike Trout,baseball,", "Pikachu,baseball,pokemon", "Zorro,baseball,wizards", "Nobody,,"].join("\n"));
    expect(preview.rows.map((r) => r.input?.game ?? null)).toEqual(["sports", "pokemon", null, null]);
    expect(preview.rows[2]?.problem).toBe('Unknown game "wizards"');
    expect(preview.rows[3]?.problem).toMatch(/No game column/);
    // Without any game column, a chosen game still wins, as it always did.
    expect(previewImport("name,sport\nMike Trout,baseball", { game: "other" }).rows[0]?.input?.game).toBe("other");
  });

  it("still refuses a game that is a name on Object.prototype", () => {
    // Headers and games are folded to lower case without punctuation before they
    // are looked up, so "constructor" is the one such name that survives the fold.
    // A plain table lookup, or `in`, returns the function for it; the guard is
    // lookup() and isGame().
    const preview = previewImport(["name,game,sport", "A,constructor,baseball", "B,Constructor,"].join("\n"));
    expect(preview.rows.map((r) => r.input)).toEqual([null, null]);
    expect(preview.rows.map((r) => r.problem)).toEqual(['Unknown game "constructor"', 'Unknown game "Constructor"']);
    // And a condition by such a name is not taken as one.
    expect(previewImport("name,game,condition\nA,pokemon,constructor").rows[0]?.input?.condition).toBe("NM");
  });

  it("reads a flag however a spreadsheet writes it, and a subgrade only as a number on the scale", () => {
    const csv = [
      "name,game,rookie,auto,relic,centering,corners,edges,surface",
      "A,sports,RC,yes,1,9,10,0,11",
      "B,sports,no,,false,55/45,x,9.5,",
    ].join("\n");
    const rows = previewImport(csv).rows;
    expect(rows[0]?.input).toMatchObject({ rookie: true, autograph: true, relic: true, subgrades: { centering: 9, corners: 10, edges: null, surface: null } });
    expect(rows[1]?.input).toMatchObject({ rookie: false, autograph: false, relic: false, subgrades: { centering: null, corners: null, edges: 9.5, surface: null } });
  });

  it("keeps a numbered card and a parallel apart from base copies, and stacks the base copies", () => {
    const csv = [
      "name,game,set,number,parallel,serial,qty",
      "Mike Trout,sports,Topps Chrome,US175,,,1",
      "Mike Trout,sports,Topps Chrome,US175,,,2",
      "Mike Trout,sports,Topps Chrome,US175,Gold Refractor,,1",
      "Mike Trout,sports,Topps Chrome,US175,Gold Refractor,12/50,1",
      "Mike Trout,sports,Topps Chrome,US175,Gold Refractor,12/50,1",
    ].join("\n");
    expect(applyImport(previewImport(csv))).toMatchObject({ created: 4, merged: 1, skipped: [] });
    expect(listCards().map((c) => `${c.parallel ?? "base"}:${c.serialNumber ?? "-"}:${c.quantity}`).sort()).toEqual(["Gold Refractor:-:1", "Gold Refractor:12/50:1", "Gold Refractor:12/50:1", "base:-:3"]);
  });

  it("reads this app's own export of a sports card back as the same card", async () => {
    const { GET } = await import("@/app/api/export/route");
    createCard({
      game: "sports", sport: "baseball", name: "Mike Trout", setName: "Topps Chrome", cardNumber: "US175", year: 2011, manufacturer: "Topps",
      team: "Los Angeles Angels", rookie: true, parallel: "Gold Refractor", serialNumber: "12/50", autograph: true, relic: false,
      gradingCompany: "BGS", grade: "9.5", certNumber: "0012345678", subgrades: { centering: 9.5, corners: 9.5, edges: 10, surface: 9 },
      centering: { front: { lr: "55/45" } },
    });
    const csv = await (await GET(new Request("http://localhost/api/export"))).text();
    const header = csv.split("\r\n")[0]!.split(",");
    expect(header).toEqual(expect.arrayContaining(["team", "rookie", "parallel", "serial_number", "autograph", "relic", "subgrade_centering", "subgrade_corners", "subgrade_edges", "subgrade_surface"]));
    const exported = listCards()[0]!;
    setDb(openDatabase(":memory:"));
    const preview = previewImport(csv);
    expect(preview.unmapped).toEqual(expect.not.arrayContaining(["team", "parallel", "serial_number", "subgrade_centering"]));
    expect(applyImport(preview)).toMatchObject({ created: 1, skipped: [] });
    expect(listCards()[0]).toMatchObject({
      name: exported.name, team: exported.team, rookie: true, parallel: "Gold Refractor", serialNumber: "12/50", autograph: true, relic: false,
      gradingCompany: "BGS", grade: "9.5", certNumber: "0012345678", subgrades: exported.subgrades, manufacturer: "Topps",
    });
  });
});
