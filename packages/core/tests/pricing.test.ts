import { beforeEach, describe, expect, it } from "vitest";
import { gradeKey, gradeLookupKeys, summarizeGraded } from "../src/domain/pricing/index";
import { CARD_GRADE_KEYS, gradingOutlook, gradingVerdict, isReadyToGrade, outlookSeries } from "../src/grading";
import { fakeProvider, widgetEngine } from "./widgets";
import type { PriceQuote } from "../src/domain/spec";

describe("refreshing", () => {
  it("records what it found and never writes a failure over a last known value", async () => {
    const answers = { Gizmo: 12 };
    const engine = widgetEngine([fakeProvider(answers)]);
    const w = engine.repo.createItem({ name: "Gizmo" });
    const first = await engine.refresh.refreshItem(w);
    expect(first.stored).toBe(true);
    expect(engine.repo.latestSnapshot(w.id)!.summary).toMatchObject({ yourCopyValue: 12, market: 12, marketSource: "Fake fake" });

    answers.Gizmo = -1;
    const second = await engine.refresh.refreshItem(engine.repo.getItem(w.id)!);
    expect(second.stored).toBe(false);
    expect(second.snapshot.summary.errors[0].message).toBe("source down");
    expect(engine.repo.listSnapshots(w.id)).toHaveLength(1);
  });

  it("stores a first look even when it has no price, so the page can explain", async () => {
    const engine = widgetEngine([fakeProvider({})]);
    const w = engine.repo.createItem({ name: "Nobody knows" });
    expect((await engine.refresh.refreshItem(w)).stored).toBe(true);
    expect(engine.repo.latestSnapshot(w.id)!.summary.yourCopyValue).toBeNull();
  });

  it("lets a value typed in by hand beat the market, and hands back when cleared", async () => {
    const engine = widgetEngine([fakeProvider({ Gizmo: 12 })]);
    const w = engine.repo.createItem({ name: "Gizmo", manualValue: 40 });
    await engine.refresh.refreshItem(w);
    expect(engine.repo.latestSnapshot(w.id)!.summary).toMatchObject({ yourCopyValue: 40, yourCopyBasis: "Your own price", market: 12 });
    engine.repo.updateItem(w.id, { manualValue: null });
    await engine.refresh.refreshItem(engine.repo.getItem(w.id)!);
    expect(engine.repo.latestSnapshot(w.id)!.summary.yourCopyValue).toBe(12);
  });

  it("prices only what has gone stale, and raises a move alert when it clears the threshold", async () => {
    const answers = { Gizmo: 10, Gadget: 5 };
    const engine = widgetEngine([fakeProvider(answers)]);
    const a = engine.repo.createItem({ name: "Gizmo" });
    engine.repo.createItem({ name: "Gadget" });
    expect(await engine.refresh.refreshAll({ staleHours: 24 })).toMatchObject({ refreshed: 2, skipped: 0 });
    expect(await engine.refresh.refreshAll({ staleHours: 24 })).toMatchObject({ refreshed: 0, skipped: 2 });
    engine.refresh.resetRefreshThrottle();
    engine.db.getDb().prepare("UPDATE price_snapshots SET fetched_at = '2020-01-01T00:00:00.000Z'").run();
    answers.Gizmo = 20;
    expect(await engine.refresh.refreshAll({ staleHours: 24 })).toMatchObject({ refreshed: 2 });
    const alerts = engine.alerts.listAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "price_move", itemId: a.id });
    expect(alerts[0].title).toMatch(/up 100\.0%/);
    expect(engine.alerts.unreadCount()).toBe(1);
    engine.alerts.markAllRead();
    expect(engine.alerts.unreadCount()).toBe(0);
  });

  it("adds a value entered by hand as a point in the history", () => {
    const engine = widgetEngine();
    const w = engine.repo.createItem({ name: "Gizmo" });
    const snap = engine.refresh.addManualSnapshot(w.id, { value: "1,250", at: "2026-02-03", note: "Appraised" });
    expect(snap.summary).toMatchObject({ yourCopyValue: 1250, yourCopyBasis: "Appraised" });
    expect(snap.fetchedAt).toMatch(/^2026-02-03/);
    expect(() => engine.refresh.addManualSnapshot(w.id, { value: "abc" })).toThrow(/number/);
  });
});

describe("settings", () => {
  let engine: ReturnType<typeof widgetEngine>;
  beforeEach(() => {
    engine = widgetEngine();
  });

  it("returns defaults, keeps what was saved, and drops what it cannot use", () => {
    expect(engine.settings.getSettings()).toMatchObject({ ownerName: "", alertMovePercent: 15, bonus: 5, multipliers: { a: 1.5 } });
    const saved = engine.settings.saveSettings({ ownerName: "  Ada ", bonus: 7, multipliers: { b: 2, bad: -1 }, alertWebhookUrl: "javascript:alert(1)" });
    expect(saved).toMatchObject({ ownerName: "Ada", bonus: 7, multipliers: { b: 2 }, alertWebhookUrl: "" });
  });

  it("names a field the browser could not turn into a number", () => {
    expect(engine.settings.validate({ bonus: null })).toEqual({ ok: false, problems: ["Bonus"] });
    expect(engine.settings.validate({ multipliers: { a: "x" } })).toEqual({ ok: false, problems: ["Multipliers (a)"] });
    expect(engine.settings.validate({ bonus: 3, exportPrivateFields: true })).toEqual({ ok: true });
  });
});

const quote = (over: Partial<PriceQuote>): PriceQuote => ({
  source: "pc",
  sourceLabel: "PriceCharting",
  currency: "USD",
  url: null,
  matchedName: "x",
  matchedDetail: null,
  price: null,
  prices: {},
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("summarising by grade", () => {
  const base = { item: { manualValue: null, manualPrices: {} }, errors: [], fetchedAt: "x", priority: ["pc"], gradeMultipliers: { "PSA 10": 3, "PSA 9": 1.4 } };

  it("values a raw copy off the ungraded price with its condition multiplier", () => {
    const s = summarizeGraded({ ...base, quotes: [quote({ price: 100, prices: { "PSA 10": 900 } })], owner: { gradeKeys: [], conditionMultiplier: 0.85, conditionLabel: "Lightly Played" } });
    expect(s).toMatchObject({ ungraded: 100, yourCopyValue: 85, graded: { "PSA 10": 900 }, gradedSource: "PriceCharting" });
    expect(s.estimatedGraded).toEqual({ "PSA 9": 140 });
  });

  it("values a graded copy from real data, then estimates, then the raw price", () => {
    const real = summarizeGraded({ ...base, quotes: [quote({ price: 100, prices: { "PSA 10": 900 } })], owner: { gradeKeys: gradeLookupKeys("PSA", "10"), conditionMultiplier: 1, conditionLabel: "" } });
    expect(real).toMatchObject({ yourCopyValue: 900 });
    const est = summarizeGraded({ ...base, quotes: [quote({ price: 100 })], owner: { gradeKeys: gradeLookupKeys("PSA", "9"), conditionMultiplier: 1, conditionLabel: "" } });
    expect(est).toMatchObject({ yourCopyValue: 140 });
    expect(est.yourCopyBasis).toMatch(/Estimated/);
  });

  it("lets prices typed in by hand win per key", () => {
    const s = summarizeGraded({
      ...base,
      item: { manualValue: 120, manualPrices: { "PSA 10": 1000 } },
      quotes: [quote({ price: 100, prices: { "PSA 10": 900, "PSA 9": 200 } })],
      owner: { gradeKeys: ["PSA 10"], conditionMultiplier: 1, conditionLabel: "" },
    });
    expect(s).toMatchObject({ ungraded: 120, ungradedSource: "Your own price", yourCopyValue: 1000, graded: { "PSA 10": 1000, "PSA 9": 200 } });
  });

  it("normalises grade labels", () => {
    expect(gradeKey("psa", "10.0")).toBe("PSA 10");
    expect(gradeKey("None", "9")).toBe("Grade 9");
    expect(gradeLookupKeys("CGC", "10")).toEqual(["CGC 10", "Grade 10", "PSA 10"]);
    expect(gradeLookupKeys("WATA", "9.8", "WATA 9.8")).toEqual(["WATA 9.8", "Grade 9.8"]);
  });
});

describe("the grading verdict", () => {
  const settings = { gradingFee: 25, readyMinUpside: 40, readyMinUpsidePercent: 50 };
  const snap = (id: number, day: number, upside: number) => ({
    id,
    fetchedAt: new Date(Date.UTC(2026, 0, 1 + day)).toISOString(),
    summary: { ungraded: 100, yourCopyValue: 100, graded: {}, estimatedGraded: { "PSA 10": 125 + upside, "PSA 8": 100 } },
  });

  it("works with a domain's own grade keys", () => {
    const o = gradingOutlook({ ungraded: 50, yourCopyValue: 50, graded: { "WATA 9.8 A+": 500 }, estimatedGraded: {} }, settings, null, { maxKeys: ["WATA 9.8 A+"], minKeys: [] });
    expect(o).toMatchObject({ max: 500, min: 50, minLabel: "Ungraded", upside: 425, fromRealData: true });
  });

  it("says skip, then wait, then prime as the gap changes", () => {
    expect(gradingVerdict(outlookSeries([snap(1, 0, -10)], settings, null, CARD_GRADE_KEYS)).kind).toBe("skip");
    expect(gradingVerdict(outlookSeries([snap(1, 0, 50), snap(2, 1, 60)], settings)).kind).toBe("insufficient");
    const prime = outlookSeries([snap(1, 0, 20), snap(2, 1, 40), snap(3, 2, 60), snap(4, 3, 80)], settings);
    expect(gradingVerdict(prime).kind).toBe("prime");
    expect(isReadyToGrade(prime, gradingVerdict(prime), settings)).toBe(true);
    expect(gradingVerdict(outlookSeries([snap(1, 0, 20), snap(2, 1, 80), snap(3, 2, 60), snap(4, 3, 40)], settings)).kind).toBe("wait");
  });
});
