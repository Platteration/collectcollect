import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { addSnapshot, createCard, getCard, latestSnapshotsByCard, listCards, listSnapshots, recentSnapshotsByCard, updateCard } from "@/lib/cards";
import { hintFromCards } from "@/lib/sets/types";
import { OUTLOOK_SNAPSHOTS, gradingVerdict, outlookSeries } from "@/lib/analytics";
import { summarize } from "@/lib/pricing";
import { readPriceSummary } from "@/lib/price-summary";
import { createScanDraft, getScanDraft, listScanDrafts } from "@/lib/scan-drafts";
import { getSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS, type PriceQuote } from "@/lib/types";
import { GET as exportCsv } from "@/app/api/export/route";
import { GET as scanDrafts } from "@/app/api/scan-drafts/route";

/**
 * Rows a restore installs from a file this app never wrote. Each shape below
 * was put into a backup, restored through the real route, and left the pages
 * named answering 500 on every load: the portfolio, the card's page and the
 * CSV export for a price snapshot, the Scan page and its API for a draft.
 */
beforeEach(() => setDb(openDatabase(":memory:")));

const quote = (over: Partial<PriceQuote>): PriceQuote => ({
  source: "pricecharting",
  sourceLabel: "PriceCharting",
  currency: "USD",
  url: "https://www.pricecharting.com/x",
  matchedName: "Pikachu",
  matchedDetail: "Base Set",
  ungraded: 10,
  ungradedVariants: {},
  graded: { "PSA 10": 120, "PSA 9": 40 },
  fetchedAt: "2026-01-01T00:00:00.000Z",
  externalId: "6910",
  ...over,
});

function insertSnapshot(cardId: number, summary: string, at: string) {
  getDb().prepare("INSERT INTO price_snapshots (card_id, fetched_at, summary) VALUES (?, ?, ?)").run(cardId, at, summary);
}

describe("a price snapshot this app did not write", () => {
  const hostile = [
    "{}",
    '{"yourCopyValue":"x","quotes":5,"errors":5,"graded":"x","estimatedGraded":[1]}',
    '{"yourCopyValue":5,"quotes":[1,null,{"source":"toString"},{"source":"scryfall","graded":"x","ungradedVariants":5}],"graded":{"PSA 10":"x","PSA 9":9}}',
  ];

  it("leaves the portfolio's outlook, the card's prices and the export readable", async () => {
    const card = createCard({ game: "pokemon", name: "Pikachu", condition: "NM" });
    hostile.forEach((summary, i) => insertSnapshot(card.id, summary, `2026-01-0${i + 1}T00:00:00.000Z`));

    const latest = latestSnapshotsByCard().get(card.id);
    expect(latest?.summary).toMatchObject({ yourCopyValue: 5, graded: { "PSA 9": 9 }, estimatedGraded: {}, errors: [] });
    expect(latest?.summary.quotes).toEqual([expect.objectContaining({ source: "scryfall", graded: {}, ungradedVariants: {} })]);
    expect(listSnapshots(card.id).map((s) => s.summary.graded)).toEqual([{ "PSA 9": 9 }, {}, {}]);

    // What the portfolio does with them.
    const series = outlookSeries(recentSnapshotsByCard(OUTLOOK_SNAPSHOTS).get(card.id) ?? [], getSettings(), "9", null, "pokemon");
    expect(() => gradingVerdict(series)).not.toThrow();
    // And the export, which reads every card's newest summary.
    const csv = await exportCsv(new Request("http://localhost/api/export"));
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("Pikachu");
  });

  it("drops one that is not an object at all, as before", () => {
    const card = createCard({ game: "pokemon", name: "Pikachu" });
    for (const summary of ["null", "1", "[]", '"x"']) insertSnapshot(card.id, summary, "2026-01-01T00:00:00.000Z");
    expect(listSnapshots(card.id)).toEqual([]);
  });

  it("reads a summary this app wrote back exactly as it was written", () => {
    const written = summarize(
      [quote({}), quote({ source: "manual", sourceLabel: "Your own price", url: null, externalId: undefined, referenceImageUrl: null, graded: { "PSA 10": 150 } })],
      [{ source: "scryfall", message: "Scryfall returned HTTP 503" }],
      DEFAULT_SETTINGS,
      { condition: "NM", gradingCompany: "PSA", grade: "9" },
      undefined,
      "2026-02-01T00:00:00.000Z",
    );
    const stored = JSON.parse(JSON.stringify({ ...written, recomputedAt: "2026-02-02T00:00:00.000Z" }));
    expect(readPriceSummary(stored, "2026-02-01T00:00:00.000Z")).toEqual(stored);
    const card = createCard({ game: "pokemon", name: "Pikachu" });
    addSnapshot(card.id, written);
    expect(listSnapshots(card.id)[0]?.summary).toEqual(JSON.parse(JSON.stringify(written)));
  });
});

describe("a card's stored centering", () => {
  it("is read in linear time on every read of the card", () => {
    // Read back through the same checks as a form's, on every page that
    // lists the card: "55", two hundred spaces and an "x" took nine seconds
    // there, and four hundred had not finished after twenty, during which
    // nothing else answered.
    const card = createCard({ game: "pokemon", name: "Pikachu" });
    const hostile = JSON.stringify({ front: { lr: `55${" ".repeat(200)}x`, tb: null }, back: null });
    getDb().prepare("UPDATE cards SET centering = ? WHERE id = ?").run(hostile, card.id);
    const started = performance.now();
    expect(listCards().map((c) => c.centering)).toEqual([null]);
    expect(getCard(card.id)?.centering).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("a scan draft this app did not write", () => {
  it("is passed over, and the Scan page's list still answers", async () => {
    const good = createScanDraft(randomUUID(), { name: `${randomUUID()}.jpg`, color: null });
    const now = new Date().toISOString();
    const insert = getDb().prepare("INSERT INTO scan_drafts (id, uploads, input, identification, status, result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const bad = [
      ["x", "{}", null, "committed", "created"],
      [JSON.stringify([`${randomUUID()}.jpg`]), "x", null, "review", null],
      [JSON.stringify(["../../session-secret"]), "{}", null, "review", null],
      [JSON.stringify([`${randomUUID()}.jpg`]), "[]", null, "review", null],
      [JSON.stringify([`${randomUUID()}.jpg`]), "{}", null, "__proto__", null],
    ].map(([uploads, input, identification, status, result]) => {
      const id = randomUUID();
      insert.run(id, uploads, input, identification, status, result, now, now);
      return id;
    });
    // An identification that cannot be read leaves the draft readable without one.
    const unidentified = randomUUID();
    insert.run(unidentified, JSON.stringify([`${randomUUID()}.jpg`]), '{"name":"Kept"}', "{", "review", "sideways", now, now);

    expect(listScanDrafts().map((d) => d.id).sort()).toEqual([good.id, unidentified].sort());
    for (const id of bad) expect(getScanDraft(id)).toBeNull();
    expect(getScanDraft(unidentified)).toMatchObject({ input: { name: "Kept" }, identification: null, result: null });
    const res = scanDrafts();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { drafts: unknown[] }).drafts).toHaveLength(2);
  });
});

describe("a card's JSON columns as a restore may leave them", () => {
  const setColumn = (id: number, column: "manual_graded" | "external_ids" | "identification", value: string) =>
    getDb().prepare(`UPDATE cards SET ${column} = ? WHERE id = ?`).run(value, id);
  const notRecords = ["null", "[1]", "[]", '"x"', "5", "true", "{"];

  it("reads manual graded prices that are not a record of figures as none, so the card's page still opens", () => {
    // `null` here made /cards/<id> answer 500 on every load: the page hands
    // the prices to Object.entries, and only an edit could have healed the
    // row, which needs that page.
    const card = createCard({ game: "pokemon", name: "Pikachu", setName: "Base Set" });
    for (const value of notRecords) {
      setColumn(card.id, "manual_graded", value);
      const read = getCard(card.id)!;
      expect(read.manualGraded, value).toEqual({});
      expect(() => Object.entries(read.manualGraded), value).not.toThrow();
    }
    // Field by field: what normalizeInput would have kept, and nothing else.
    setColumn(card.id, "manual_graded", JSON.stringify({ "PSA 9": 9, " BGS 9.5 ": 40, "PSA 10": "450", "": 4, "  ": 5, CGC: -1, SGC: 1e15, TAG: null, "__proto__": 7 }));
    const read = getCard(card.id)!.manualGraded;
    expect(read).toEqual({ "PSA 9": 9, "BGS 9.5": 40 });
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    // And an edit through the app goes through, rather than tripping over the row.
    expect(updateCard(card.id, { quantity: 2 })?.manualGraded).toEqual({ "PSA 9": 9, "BGS 9.5": 40 });
  });

  it("reads provider ids that are not a record of text as none, so a set's checklist can still be fetched", () => {
    // `null` here answered POST /api/sets/refresh with a 502: the hint for the
    // set's provider walks every owned card's ids with Object.entries.
    const card = createCard({ game: "pokemon", name: "Pikachu", setName: "Base Set" });
    for (const value of notRecords) {
      setColumn(card.id, "external_ids", value);
      expect(getCard(card.id)!.externalIds, value).toEqual({});
      expect(hintFromCards(listCards()), value).toMatchObject({ setName: "Base Set", externalIds: {} });
    }
    setColumn(card.id, "external_ids", JSON.stringify({ pricecharting: " 6910 ", tcgplayer: 42, scryfall: { id: 1 }, ebay: null, other: "", nan: Number.NaN, "__proto__": "x" }));
    expect(getCard(card.id)!.externalIds).toEqual({ pricecharting: "6910", tcgplayer: "42" });
  });

  it("reads an identification through the same checks a saved one passes, and drops one that fails them", () => {
    const card = createCard({ game: "pokemon", name: "Pikachu" });
    for (const value of [...notRecords, '{"confidence":"high"}', '{"condition_assessment":{"caveat":5}}', '{"alternatives":{}}', '{"grading":[]}']) {
      setColumn(card.id, "identification", value);
      expect(getCard(card.id)!.identification, value).toBeNull();
    }
    // An older identification, before the condition assessment existed, is still one.
    setColumn(card.id, "identification", JSON.stringify({ game: "pokemon", name: "Pikachu", confidence: 0.9, alternatives: [], unknownLater: true }));
    expect(getCard(card.id)!.identification).toEqual({ game: "pokemon", name: "Pikachu", confidence: 0.9, alternatives: [] });
  });

  it("reads what the app itself wrote exactly as it was written", () => {
    const identification = {
      game: "pokemon" as const, sport: null, name: "Pikachu", set_name: "Base Set", set_code: null, card_number: "58/102", year: 1999,
      rarity: "Common", variant: null, language: "English", manufacturer: null, subject: "Pikachu",
      grading: { company: null, grade: null, cert_number: null }, condition_notes: null,
      condition_assessment: { centering: "55/45", corners: "sharp", edges: "clean", surface: "clean", estimated_grade_low: "8", estimated_grade_high: "9", caveat: null, centering_ratios: null },
      confidence: 0.92, alternatives: [{ name: "Pikachu", set_name: "Jungle", card_number: "60/64", reason: "a reprint" }], search_query: "Pikachu 58/102 Base Set",
    };
    const card = createCard({ game: "pokemon", name: "Pikachu", identification, manualGraded: { "PSA 10": 450, "PSA 9": 120.5 }, externalIds: { pricecharting: "6910", scryfall: "abc-123" } });
    const read = getCard(card.id)!;
    expect(read.identification).toEqual(identification);
    expect(read.manualGraded).toEqual({ "PSA 10": 450, "PSA 9": 120.5 });
    expect(read.externalIds).toEqual({ pricecharting: "6910", scryfall: "abc-123" });
  });
});
