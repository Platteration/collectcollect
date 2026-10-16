import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OutlookPoint } from "../src/grading";

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
