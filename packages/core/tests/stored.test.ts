import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GRADED_SUMMARY_FIELDS, SIMPLE_SUMMARY_FIELDS } from "../src/domain/pricing/index";
import { UNREADABLE_SUMMARY_BASIS, readPrices, readStoredSummary } from "../src/domain/stored";
import { widgetEngine } from "./widgets";

// The item page is a server component in a Next app; what it needs of the
// router is only that the client components under it can ask for one.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/",
}));
const { ItemPage } = await import("../src/pages/ItemPage");

/**
 * What a restore can install: rows this app never wrote. Each of these, read
 * as it stood, took down every page that listed the item it belongs to.
 */
const unreadable = ["not json at all", "null", "[1]", '"a string"', "42", "{"];
const AT = "2026-05-01T00:00:00.000Z";

describe("a stored price summary, read field by field", () => {
  it("reads one the app wrote exactly as it was written", () => {
    const written = {
      currency: "USD",
      fetchedAt: AT,
      yourCopyValue: 12.5,
      yourCopyBasis: "Your own price",
      quotes: [{ source: "manual", sourceLabel: "Manual", currency: "USD", url: null, matchedName: "Gizmo", matchedDetail: null, price: 12.5, prices: { Loose: 3 }, fetchedAt: AT, externalId: "x1", referenceImageUrl: null }],
      errors: [{ source: "pricecharting", message: "timed out" }],
      ungraded: 10,
      ungradedSource: "PriceCharting",
      graded: { "Grade 9.8": 400 },
      gradedSource: "PriceCharting",
      estimatedGraded: { "Grade 9.0": 50 },
    };
    expect(readStoredSummary(JSON.stringify(written), "2000-01-01T00:00:00.000Z", GRADED_SUMMARY_FIELDS)).toStrictEqual(written);
  });

  it("reads one that is not an object at all as a summary with no price, which says so", () => {
    for (const raw of unreadable) {
      expect(readStoredSummary(raw, AT, GRADED_SUMMARY_FIELDS), raw).toStrictEqual({
        currency: "USD",
        fetchedAt: AT,
        yourCopyValue: null,
        yourCopyBasis: UNREADABLE_SUMMARY_BASIS,
        quotes: [],
        errors: [],
        ungraded: null,
        ungradedSource: null,
        graded: {},
        gradedSource: null,
        estimatedGraded: {},
      });
    }
  });

  it("keeps each field that is what it says, and leaves out each that is not", () => {
    const stored = {
      fetchedAt: 7,
      yourCopyValue: "12",
      yourCopyBasis: ["x"],
      quotes: [null, 3, { price: 5 }, { source: "a", currency: "GBP", price: 1 }, { source: "b", price: "5", prices: { A: 1, B: "2", C: null, D: Infinity } }],
      errors: [{ source: "a" }, "boom", { source: "b", message: "down" }],
      market: "100",
      marketSource: 3,
    };
    expect(readStoredSummary(JSON.stringify(stored), AT, SIMPLE_SUMMARY_FIELDS)).toStrictEqual({
      currency: "USD",
      fetchedAt: AT,
      yourCopyValue: null,
      yourCopyBasis: "",
      quotes: [{ source: "b", sourceLabel: "b", currency: "USD", url: null, matchedName: "", matchedDetail: null, price: null, prices: { A: 1 }, fetchedAt: AT }],
      errors: [{ source: "b", message: "down" }],
      market: null,
      marketSource: null,
    });
  });

  it("gives every price table of the app's own an object to read, even one the row left out or broke", () => {
    const summary = readStoredSummary(JSON.stringify({ graded: null, estimatedGraded: [1, 2] }), AT, GRADED_SUMMARY_FIELDS);
    expect(Object.keys(summary.graded)).toEqual([]);
    expect(Object.keys(summary.estimatedGraded)).toEqual([]);
  });

  it("keeps a key named __proto__ as an ordinary price rather than letting it reach the prototype", () => {
    const prices = readPrices(JSON.parse('{"__proto__": 5, "PSA 10": 9}'));
    expect(Object.getPrototypeOf(prices)).toBe(Object.prototype);
    expect(Object.keys(prices).sort()).toEqual(["PSA 10", "__proto__"]);
  });
});

describe("an item whose stored rows a restore wrote", () => {
  let engine: ReturnType<typeof widgetEngine>;
  beforeEach(() => {
    engine = widgetEngine();
  });

  const breakSnapshots = (itemId: number) => {
    const insert = engine.db.getDb().prepare("INSERT INTO price_snapshots (item_id, fetched_at, summary) VALUES (?, ?, ?)");
    unreadable.forEach((raw, i) => insert.run(itemId, `2026-0${(i % 9) + 1}-01T00:00:00.000Z`, raw));
  };

  it("lists, finds and folds its price history without throwing", () => {
    const item = engine.repo.createItem({ name: "Restored" });
    breakSnapshots(item.id);
    const history = engine.repo.listSnapshots(item.id);
    expect(history).toHaveLength(unreadable.length);
    for (const snapshot of history) expect(snapshot.summary).toMatchObject({ yourCopyValue: null, yourCopyBasis: UNREADABLE_SUMMARY_BASIS, quotes: [], market: null });
    expect(engine.repo.latestSnapshot(item.id)?.summary.yourCopyValue).toBeNull();
    expect(engine.repo.allSnapshots()).toHaveLength(unreadable.length);
    expect(engine.repo.latestSnapshotsByItem().get(item.id)?.summary.errors).toEqual([]);
  });

  it("reads its JSON columns as what they should hold, whatever they do hold", () => {
    const item = engine.repo.createItem({ name: "Restored" });
    engine.db.getDb().prepare("UPDATE items SET manual_prices = 'null', external_ids = '[1]', identification = '\"x\"' WHERE id = ?").run(item.id);
    expect(engine.repo.getItem(item.id)).toMatchObject({ manualPrices: {}, externalIds: {}, identification: null });
    engine.db.getDb().prepare(`UPDATE items SET manual_prices = '{"Loose": 4, "CIB": "x"}', external_ids = '{"pricecharting": "123", "other": 5}', identification = '{"name": "Gizmo"}' WHERE id = ?`).run(item.id);
    expect(engine.repo.getItem(item.id)).toMatchObject({ manualPrices: { Loose: 4 }, externalIds: { pricecharting: "123" }, identification: { name: "Gizmo" } });
  });

  it("still has a page, and a Markdown file", async () => {
    const item = engine.repo.createItem({ name: "Restored" });
    breakSnapshots(item.id);
    engine.db.getDb().prepare("UPDATE items SET manual_prices = 'null', external_ids = 'null' WHERE id = ?").run(item.id);
    const html = renderToStaticMarkup(await ItemPage({ engine, params: Promise.resolve({ id: String(item.id) }) }));
    expect(html).toContain("Restored");
    const restored = engine.repo.getItem(item.id);
    if (!restored) throw new Error("the restored item is not there");
    expect(engine.mirror.render(restored)).toContain("Restored");
  });
});
