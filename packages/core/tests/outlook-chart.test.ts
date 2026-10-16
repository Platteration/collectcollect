import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OutlookPoint } from "../src/grading";

/**
 * The grading outlook chart the domain apps draw, rendered on the server (the
 * way Next first draws it). The card app's own copy of this chart carries the
 * same two repairs: every point carries its own x position instead of being
 * looked up by index (the drawing tests here), and the scale's ends are found with a loop
 * rather than a spread that a long series overflows (held by
 * outlook-chart-long.test.ts).
 */

// The crosshair follows the pointer, which a server render never has, so the
// tests choose where it rests (null: nowhere) to draw the chart as it looks
// when it is being read.
const crosshair = vi.hoisted(() => ({ at: null as number | null }));
vi.mock("../src/charts/chart-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/charts/chart-utils")>()),
  useCrosshair: () => ({ index: crosshair.at, setIndex: () => undefined, onMove: () => undefined, onLeave: () => undefined, onKey: () => undefined }),
}));

const { OutlookChart } = await import("../src/components/OutlookChart");

const point = (t: string, raw: number, max: number, min = raw): OutlookPoint => ({
  t,
  raw,
  min,
  max,
  fee: 20,
  upside: max - raw - 20,
  downside: min - raw - 20,
  minLabel: "Ungraded",
  maxLabel: "PSA 10",
  likely: null,
  likelyLabel: null,
  fromRealData: true,
});

const series = [point("2026-01-01T00:00:00.000Z", 50, 200), point("2026-02-01T00:00:00.000Z", 60, 260), point("2026-03-01T00:00:00.000Z", 70, 300)];
const draw = (points: OutlookPoint[], at: number | null = null) => {
  crosshair.at = at;
  return renderToStaticMarkup(createElement(OutlookChart, { series: points }));
};

describe("the grading outlook chart", () => {
  it("says there is nothing to draw before there is a price", () => {
    const html = draw([]);
    expect(html).toContain("No outlook yet. Refresh prices first.");
    expect(html).not.toContain("<svg");
  });

  it("describes the latest point to a screen reader, and draws a band and three lines over time", () => {
    const html = draw(series);
    expect(html).toContain("Latest PSA 10 $300.00, Ungraded $70.00, raw $70.00, upside after the $20.00 fee $210.00.");
    expect(html.match(/<path /g)).toHaveLength(4);
    expect(html.match(/text-anchor="[a-z]+"/g)).toEqual(['text-anchor="start"', 'text-anchor="middle"', 'text-anchor="end"']);
    expect(html).not.toContain("tooltip-surface");
    expect(html.match(/<circle /g)).toBeNull();
  });

  it("draws one point as three flat lines", () => {
    const html = draw(series.slice(0, 1));
    expect(html).toContain("Latest PSA 10 $200.00");
    expect(html).not.toContain("<path ");
    expect(html.match(/<line /g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("marks the point the crosshair rests on, and reads its values out", () => {
    const html = draw(series, 1);
    expect(html.match(/<circle /g)).toHaveLength(3);
    expect(html).toContain("tooltip-surface");
    expect(html).toContain("$260.00");
    expect(html).toContain("Upside after $20.00 fee: <strong>$180.00</strong>");
    expect(html).toContain(": PSA 10 $260.00, Ungraded $60.00, raw $60.00, upside after the $20.00 fee $180.00.");
  });

  it("reads out the last point too, and draws no crosshair for one left past the end of a shorter series", () => {
    expect(draw(series, 2)).toContain("tooltip-surface");
    expect(draw(series, 7)).not.toContain("tooltip-surface");
  });
});

// The same chart drawn with its props, the crosshair resting nowhere.
const start = Date.UTC(2026, 0, 1);

const dayPoint = (i: number, over: Partial<OutlookPoint> = {}): OutlookPoint => ({
  t: new Date(start + i * 86_400_000).toISOString(),
  raw: 100 + i,
  min: 120 + i,
  minLabel: "Grade 8",
  max: 300 + i,
  maxLabel: "PSA 10",
  fee: 25,
  upside: 175,
  downside: -5,
  fromRealData: true,
  likely: null,
  likelyLabel: null,
  ...over,
});

const drawWith = (points: OutlookPoint[], props: { compact?: boolean; rawLabel?: string } = {}) => {
  crosshair.at = null;
  return renderToStaticMarkup(createElement(OutlookChart, { series: points, ...props }));
};

describe("the outlook chart", () => {
  it("says there is no outlook for an empty series", () => {
    expect(drawWith([])).toContain("No outlook yet. Refresh prices first.");
  });

  it("describes the latest point for a screen reader, and names the owner's own line as it is told to", () => {
    const html = drawWith([dayPoint(0), dayPoint(1), dayPoint(2)], { rawLabel: "Your sealed copy" });
    expect(html).toContain("Latest PSA 10 $302.00, Grade 8 $122.00, raw $102.00, upside after the $25.00 fee $175.00.");
    expect(html).toContain("Use the left and right arrow keys to read each point.");
    expect(html).toContain("Your sealed copy");
    expect(html).not.toContain("Your raw copy");
    expect(drawWith([dayPoint(0)])).toContain("Your raw copy");
  });

  it("labels the axis with dates, draws three lines and a band, and never a NaN", () => {
    const html = drawWith([dayPoint(0), dayPoint(10), dayPoint(20), dayPoint(30)]);
    expect(html).toContain("Jan 1");
    expect(html).toContain("Jan 31");
    expect((html.match(/<path /g) ?? []).length).toBe(4);
    expect(html).not.toContain("NaN");
  });

  it("draws one point as three flat lines, and two points at the same instant without a NaN", () => {
    const single = drawWith([dayPoint(0)]);
    expect((single.match(/<line /g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(single).not.toContain("<path d=\"M");
    const sameInstant = drawWith([dayPoint(0), dayPoint(0, { raw: 90 })]);
    expect(sameInstant).not.toContain("NaN");
  });

  it("draws a compact version with no axis and no legend", () => {
    const html = drawWith([dayPoint(0), dayPoint(1), dayPoint(2)], { compact: true });
    expect(html).not.toContain("Jan 1");
    expect(html).not.toContain("(max)");
    expect(html).not.toContain("Use the left and right arrow keys");
  });
});
