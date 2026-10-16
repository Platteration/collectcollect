import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { cleanServiceHistory } from "@/lib/types";

/**
 * A spreadsheet's service-history cell is text the app did not write, up to
 * the import's 8 MB, and it is read on the one thread every request shares.
 * Its entries were read with a pattern whose note could also begin with the
 * spaces before it, so a run of spaces was shared by two slots: twenty thousand
 * spaces took a third of a second and the time grew with the square of the
 * run. The budget is far above what a scan costs and far below what that did.
 * (CLAUDE.md, "Input from outside"; the card app's tests/linear-parsing.test.ts
 * holds its readers to the same.)
 */
const BUDGET_MS = 1000;

function timed<T>(read: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = read();
  return { value, ms: performance.now() - started };
}

/** What a reader answered: the entries, or the reason it refused. */
const outcome = (read: () => unknown) => {
  try {
    return { entries: read() };
  } catch (e) {
    return { refused: e instanceof Error ? e.message : String(e) };
  }
};

/** Short strings drawn from `tokens`, the same ones for the same seed. */
function drawn(tokens: string[], count: number, seed: number, most = 8): string[] {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => {
    let text = "";
    for (let n = Math.floor(next() * (most + 1)); n > 0; n--) text += tokens[Math.floor(next() * tokens.length)];
    return text;
  });
}

describe("a service-history cell", () => {
  it("is read in linear time however long its runs of spaces are", () => {
    for (const cell of [`2026-01-01:${" ".repeat(200_000)}\rx\ry`, `2026-01-01 -${"\t".repeat(200_000)}\u2028x\u2028y`, `2026-01-01${" ".repeat(200_000)}:`]) {
      const run = timed(() => outcome(() => cleanServiceHistory(cell)));
      expect(run.value).toEqual({ refused: "Every service entry needs a date (YYYY-MM-DD)" });
      expect(run.ms).toBeLessThan(BUDGET_MS);
    }
    const long = timed(() => cleanServiceHistory(`2026-01-01:${" ".repeat(200_000)}Full service`));
    expect(long.value).toEqual([{ date: "2026-01-01", notes: "Full service" }]);
    expect(long.ms).toBeLessThan(BUDGET_MS);
  });

  it("is read in linear time where a spreadsheet puts it", () => {
    const cell = `2026-01-01:${" ".repeat(200_000)}\rx\ry`;
    const run = timed(() => engine.csv.previewImport(["brand,model,service", `Omega,Speedmaster,"${cell}"`].join("\n")));
    expect(run.value.rows[0]?.warning).toMatch(/Service history/);
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });

  it("still reads the entries a person writes", () => {
    expect(cleanServiceHistory("2021-03-04: Full service at Omega; 2024-01-10 – Crystal replaced\n2019-05-05 -  Pushers")).toEqual([
      { date: "2019-05-05", notes: "Pushers" },
      { date: "2021-03-04", notes: "Full service at Omega" },
      { date: "2024-01-10", notes: "Crystal replaced" },
    ]);
  });

  it("reads exactly what the pattern it replaced read, on short cells drawn from the characters that matter", () => {
    const before = (text: string) =>
      cleanServiceHistory(
        text
          .trim()
          .split(/[;\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((part) => {
            const m = part.match(/^(\d{4}-\d{2}-\d{2})\s*[:\-–]\s*(.+)$/);
            return m ? { date: m[1], notes: m[2] } : { date: "", notes: part };
          }),
      );
    const breaks = ["\n", "\r", "\r\n", "\u2028", "\u2029"];
    const cells = [
      ...drawn(["2026-01-01", ":", "-", "–", "x", "fixed", ";", " ", "  ", "\t", "\u00a0", ...breaks], 20_000, 11),
      // Most starting the way an entry does, so they get as far as the note.
      ...drawn(["x", "fixed", ":", "-", ";", " ", "  ", "\t", "\u00a0", ...breaks], 20_000, 12).map((rest) => `2026-01-01:${rest}`),
    ];
    const read = cells.map((cell) => [cell, outcome(() => cleanServiceHistory(cell)), outcome(() => before(cell))] as const);
    // Reaching the cases that matter: a good many read as entries, and a good many are refused.
    expect(read.filter(([, now]) => "entries" in now && (now.entries as unknown[]).length > 0).length).toBeGreaterThan(1000);
    expect(read.filter(([, now]) => "refused" in now).length).toBeGreaterThan(1000);
    expect(read.filter(([, now, then]) => JSON.stringify(now) !== JSON.stringify(then)).slice(0, 5).map(([cell]) => cell)).toEqual([]);
  });
});
