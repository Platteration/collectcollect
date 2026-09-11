import { beforeEach, describe, expect, it } from "vitest";
import { alertsForRefresh, createAlert, deleteAlert, listAlerts, markAllRead, unreadCount } from "@/lib/alerts";
import { getDb } from "@/lib/db";
import { openLiveDatabase, setDb } from "@/lib/db";
import { DEFAULT_SETTINGS, type CardRecord, type PriceSnapshot, type PriceSummary } from "@/lib/types";

const summary = (over: Partial<PriceSummary>): PriceSummary => ({
  currency: "USD",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ungraded: null,
  ungradedSource: null,
  graded: {},
  gradedSource: null,
  estimatedGraded: {},
  yourCopyValue: null,
  yourCopyBasis: "",
  quotes: [],
  errors: [],
  ...over,
});

const card = (over: Partial<CardRecord> = {}) =>
  ({ id: 1, name: "Charizard", grade: null, gradingCompany: null, identification: null, quantity: 1, ...over }) as CardRecord;

const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
const snap = (i: number, s: PriceSummary): PriceSnapshot => ({ id: i, cardId: 1, fetchedAt: day(i), summary: { ...s, fetchedAt: day(i) } });

describe("alertsForRefresh", () => {
  it("flags a move past the threshold, in either direction", () => {
    const before = summary({ yourCopyValue: 100 });
    const up = alertsForRefresh(card(), before, summary({ yourCopyValue: 130 }), [], DEFAULT_SETTINGS);
    expect(up.map((a) => a.kind)).toContain("price_move");
    expect(up[0].title).toMatch(/up 30.0%/);
    const down = alertsForRefresh(card(), before, summary({ yourCopyValue: 70 }), [], DEFAULT_SETTINGS);
    expect(down[0].title).toMatch(/down 30.0%/);
    const small = alertsForRefresh(card(), before, summary({ yourCopyValue: 105 }), [], DEFAULT_SETTINGS);
    expect(small.map((a) => a.kind)).not.toContain("price_move");
  });

  it("stays quiet about a card whose copies have all been sold", () => {
    const fired = alertsForRefresh(card({ quantity: 0 }), summary({ yourCopyValue: 100 }), summary({ yourCopyValue: 400 }), [], DEFAULT_SETTINGS);
    expect(fired).toEqual([]);
  });

  it("says nothing about a move when there is no earlier price", () => {
    expect(alertsForRefresh(card(), null, summary({ yourCopyValue: 100 }), [], DEFAULT_SETTINGS).map((a) => a.kind)).not.toContain("price_move");
  });

  it("announces real graded prices replacing estimates, once", () => {
    const before = summary({ yourCopyValue: 100, estimatedGraded: { "PSA 10": 300 } });
    const after = summary({ yourCopyValue: 100, graded: { "PSA 10": 420 } });
    const first = alertsForRefresh(card(), before, after, [], DEFAULT_SETTINGS);
    expect(first.find((a) => a.kind === "graded_data")?.body).toMatch(/\$420/);
    expect(alertsForRefresh(card(), after, after, [], DEFAULT_SETTINGS).map((a) => a.kind)).not.toContain("graded_data");
    // a card the owner already had graded does not need this
    expect(alertsForRefresh(card({ grade: "9" }), before, after, [], DEFAULT_SETTINGS).map((a) => a.kind)).not.toContain("graded_data");
  });

  it("fires once when a card first becomes worth grading", () => {
    // Three flat refreshes, then a jump in the gem-mint price that clears the thresholds.
    const flat = summary({ ungraded: 100, yourCopyValue: 100, estimatedGraded: { "PSA 10": 150, "PSA 8": 100 } });
    const history = [snap(1, flat), snap(2, flat), snap(3, flat)];
    const jump = summary({ ungraded: 100, yourCopyValue: 100, estimatedGraded: { "PSA 10": 400, "PSA 8": 100 } });
    const fired = alertsForRefresh(card(), flat, { ...jump, fetchedAt: day(4) }, history, DEFAULT_SETTINGS);
    expect(fired.map((a) => a.kind)).toContain("ready_to_grade");
    expect(fired.find((a) => a.kind === "ready_to_grade")?.body).toMatch(/\$275/);
    // a tie in timestamps must not put the new reading at the front of the series
    const tied = alertsForRefresh(card(), flat, { ...jump, fetchedAt: day(3) }, history, DEFAULT_SETTINGS);
    expect(tied.map((a) => a.kind)).toContain("ready_to_grade");
    // already ready before this refresh: no repeat
    const already = alertsForRefresh(card(), jump, { ...jump, fetchedAt: day(5) }, [...history, snap(4, jump)], DEFAULT_SETTINGS);
    expect(already.map((a) => a.kind)).not.toContain("ready_to_grade");
  });
});

describe("alert storage", () => {
  beforeEach(() => setDb(openLiveDatabase(":memory:")));

  it("stores, counts, marks read and deletes", () => {
    const a = createAlert({ kind: "price_move", cardId: null, title: "t", body: "b" });
    createAlert({ kind: "graded_data", cardId: null, title: "t2", body: "b2" });
    expect(unreadCount()).toBe(2);
    expect(listAlerts()).toHaveLength(2);
    expect(markAllRead()).toBe(2);
    expect(unreadCount()).toBe(0);
    expect(deleteAlert(a.id)).toBe(true);
    expect(deleteAlert(a.id)).toBe(false);
    expect(listAlerts()).toHaveLength(1);
  });

  /**
   * A kind this app never wrote can only arrive with a restored database, and
   * the page that lists alerts is the page an alert is dismissed from: if that
   * page throws, the row cannot be got rid of through the app at all. So the
   * row reads back as it is, and the badge renders it rather than indexing a
   * table with it — `KIND_LABEL["__proto__"]` is Object.prototype, which React
   * refuses as a child.
   */
  it("still lists an alert whose kind is a name off Object.prototype", async () => {
    for (const kind of ["__proto__", "constructor", "toString", "not_a_kind"]) {
      getDb().prepare("INSERT INTO alerts (kind, card_id, title, body, created_at) VALUES (?, NULL, 't', 'b', 't')").run(kind);
    }
    const listed = listAlerts();
    expect(listed).toHaveLength(4);

    const { alertBadge } = await import("@/components/AlertList");
    for (const alert of listed) {
      const badge = alertBadge(alert.kind);
      // Text, not an object, and a class name from the table rather than one
      // built out of the row.
      expect(typeof badge.label).toBe("string");
      expect(badge.label).toBe(alert.kind);
      expect(badge.className).not.toContain(alert.kind);
      expect(badge.className).toMatch(/^[\w\s:-]+$/);
    }
    // And a kind this app does write still gets its own label and colour.
    expect(alertBadge("price_move")).toEqual({ label: "Price move", className: expect.stringContaining("amber") });
  });
});
