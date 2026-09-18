import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const FORBIDDEN = ["--chart-good", "--chart-bad", "--chart-series-"];

describe("color schemes never touch gain/loss or categorical chart colors", () => {
  it("carries no [data-scheme] rule that redefines --chart-good*/--chart-bad*/--chart-series-*", () => {
    const schemeLines = CSS.split("\n").filter((line) => line.includes("[data-scheme="));
    expect(schemeLines.length).toBeGreaterThan(0);
    for (const line of schemeLines) {
      for (const token of FORBIDDEN) expect(line).not.toContain(token);
    }
  });
});
