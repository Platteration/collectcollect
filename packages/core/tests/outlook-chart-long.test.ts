import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OutlookChart } from "../src/components/OutlookChart";
import type { OutlookPoint } from "../src/grading";

// Formatting a label is the slow part of drawing sixty thousand points
// (toLocaleDateString, once for each), and it is not what this test is about.
vi.mock("../src/charts/chart-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/charts/chart-utils")>()),
  shortDate: (iso: string) => iso.slice(5, 10),
}));

describe("the outlook chart over a long history", () => {
  it("finds the ends of its scale without a spread, which a series this long overflows", () => {
    // A point a minute for six weeks, three prices each: 180,000 values, more than a call can be handed.
    const start = Date.UTC(2026, 0, 1);
    const series = Array.from(
      { length: 60_000 },
      (_, i): OutlookPoint => ({
        t: new Date(start + i * 60_000).toISOString(),
        raw: 100 + (i % 7),
        min: 120,
        minLabel: "Grade 8",
        max: 300,
        maxLabel: "PSA 10",
        fee: 25,
        upside: 175,
        downside: -5,
        fromRealData: true,
        likely: null,
        likelyLabel: null,
      }),
    );
    expect(() => Math.max(...series.flatMap((p) => [p.min, p.max, p.raw]))).toThrow(RangeError);
    const html = renderToStaticMarkup(createElement(OutlookChart, { series }));
    expect(html).toContain("Latest PSA 10 $300.00");
    expect(html).not.toContain("NaN");
  });
});
