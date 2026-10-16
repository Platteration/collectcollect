import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OutlookChart } from "../src/components/OutlookChart";
import type { OutlookPoint } from "../src/grading";

/**
 * The grading outlook chart the domain apps draw, rendered on the server (the
 * way Next first draws it). The card app's own copy of this chart carries the
 * same two repairs: every point carries its own x position instead of being
 * looked up by index (the drawing tests here), and the scale's ends are found with a loop
 * rather than a spread that a long series overflows (held by
 * outlook-chart-long.test.ts).
 */

const start = Date.UTC(2026, 0, 1);

const point = (i: number, over: Partial<OutlookPoint> = {}): OutlookPoint => ({
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

const draw = (series: OutlookPoint[], props: { compact?: boolean; rawLabel?: string } = {}) => renderToStaticMarkup(createElement(OutlookChart, { series, ...props }));

describe("the outlook chart", () => {
  it("says there is no outlook for an empty series", () => {
    expect(draw([])).toContain("No outlook yet. Refresh prices first.");
  });

  it("describes the latest point for a screen reader, and names the owner's own line as it is told to", () => {
    const html = draw([point(0), point(1), point(2)], { rawLabel: "Your sealed copy" });
    expect(html).toContain("Latest PSA 10 $302.00, Grade 8 $122.00, raw $102.00, upside after the $25.00 fee $175.00.");
    expect(html).toContain("Use the left and right arrow keys to read each point.");
    expect(html).toContain("Your sealed copy");
    expect(html).not.toContain("Your raw copy");
    expect(draw([point(0)])).toContain("Your raw copy");
  });

  it("labels the axis with dates, draws three lines and a band, and never a NaN", () => {
    const html = draw([point(0), point(10), point(20), point(30)]);
    expect(html).toContain("Jan 1");
    expect(html).toContain("Jan 31");
    expect((html.match(/<path /g) ?? []).length).toBe(4);
    expect(html).not.toContain("NaN");
  });

  it("draws one point as three flat lines, and two points at the same instant without a NaN", () => {
    const single = draw([point(0)]);
    expect((single.match(/<line /g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(single).not.toContain("<path d=\"M");
    const sameInstant = draw([point(0), point(0, { raw: 90 })]);
    expect(sameInstant).not.toContain("NaN");
  });

  it("draws a compact version with no axis and no legend", () => {
    const html = draw([point(0), point(1), point(2)], { compact: true });
    expect(html).not.toContain("Jan 1");
    expect(html).not.toContain("(max)");
    expect(html).not.toContain("Use the left and right arrow keys");
  });
});
