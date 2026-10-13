import { describe, expect, it } from "vitest";
import { parseItemMarkdown } from "@/lib/markdown/item";
import { EXTERIOR_ALIASES, exteriorFromName, guessCategory, splitName } from "@/lib/naming";
import { EXTERIOR_IDS } from "@/lib/types";
import { lookup } from "@collectcollect/core/lookup";
import { previewImport } from "@/lib/import";
import { parseInventory, type SteamDescription } from "@/lib/steam/inventory";

/**
 * Text the app did not write — a spreadsheet's name column, an item file read
 * back in — is read in time proportional to its length. Each input below is
 * one the pattern it replaced took seconds over while the server answered
 * nothing else; the budget is far above what a scan of it costs and far below
 * what those patterns did.
 */
const BUDGET_MS = 1000;

function timed<T>(read: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = read();
  return { value, ms: performance.now() - started };
}

const spaces = (n: number) => " ".repeat(n);

describe("reading a name", () => {
  it("reads a name of a hundred thousand brackets in linear time", () => {
    // Sixty thousand "(" in one spreadsheet cell held the whole server for
    // eleven seconds, and the file may be 8 MB.
    const hostile = "(".repeat(100_000);
    const wear = timed(() => [exteriorFromName(hostile), guessCategory(`${hostile} x`)] as const);
    expect(wear.value).toEqual([null, null]);
    expect(wear.ms).toBeLessThan(BUDGET_MS);
    const gun = timed(() => splitName(`AK-47 | ${hostile}`));
    expect(gun.value).toEqual({ weapon: "AK-47", finish: hostile });
    expect(gun.ms).toBeLessThan(BUDGET_MS);
    expect(splitName(`AK-47 | ${hostile})`)).toEqual({ weapon: "AK-47", finish: null });
    const preview = timed(() => previewImport(`name,category\n${hostile},weapon\n`));
    expect(preview.value.rows[0]?.input?.exterior).toBeNull();
    expect(preview.ms).toBeLessThan(BUDGET_MS);
  });

  it("still reads the wear tier and the gun out of a real name", () => {
    expect(exteriorFromName("StatTrak™ AK-47 | Redline (Field-Tested)  ")).toBe("field_tested");
    expect(exteriorFromName("AK-47 | Redline ((Minimal Wear)")).toBe("minimal_wear");
    expect(exteriorFromName("AK-47 | Redline (Field-Tested) x")).toBeNull();
    expect(exteriorFromName("AK-47 | Redline ()")).toBeNull();
    expect(splitName("StatTrak™ AK-47 | Redline (Field-Tested)")).toEqual({ weapon: "AK-47", finish: "Redline" });
    expect(splitName("★ Karambit | Doppler  ()  ")).toEqual({ weapon: "Karambit", finish: "Doppler" });
    expect(splitName("Sticker | Titan (Holo) | Katowice 2014")).toEqual({ weapon: "Sticker", finish: "Titan (Holo) | Katowice 2014" });
  });
});

describe("reading an item file back in", () => {
  const file = (rows: { market?: string; markets?: string; lots?: string }) =>
    [
      "---",
      'market_hash_name: "Clutch Case"',
      'category: "case"',
      "quantity: 1",
      "---",
      "",
      "# Clutch Case",
      "",
      "## Value history",
      "",
      "| Date | Your copy | Market | Basis | Markets |",
      "| --- | --- | --- | --- | --- |",
      `| 2026-03-01T00:00:00.000Z | $9.00 | ${rows.market ?? "$9.00 (Skinport)"} | Skinport | ${rows.markets ?? "Skinport $1.20 · CSFloat $4.15"} |`,
      "",
      "## Sales",
      "",
      "| Sold | Copies | Each | Fees | Cost each | Venue | Notes | Lots |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      `| 2026-03-02T00:00:00.000Z | 1 | $20.00 | $1.00 | $5.00 | Skinport | — | ${rows.lots ?? "1 @ $5.00 (2026-01-01)"} |`,
      "",
    ].join("\n");

  it("reads a markets cell of tens of thousands of spaces in linear time", () => {
    const run = timed(() => parseItemMarkdown(file({ markets: `Skinport $1.20 · a b${spaces(100_000)}c · CSFloat $4.15` })));
    expect(run.value?.snapshots[0]?.summary.quotes.map((q) => [q.source, q.price])).toEqual([["skinport", 1.2], ["csfloat", 4.15]]);
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });

  it("reads a sale's lot cell and a market cell of hostile text in linear time", () => {
    // Two thousand spaces in a lot cell took four seconds; the time grew with
    // the cube of the length.
    const run = timed(() => parseItemMarkdown(file({ lots: `1 @ a${spaces(3000)}x · 2 @ $3.00 (2026-01-05)`, market: "(".repeat(64_000) })));
    expect(run.value?.sales[0]?.lots).toEqual([
      { quantity: 1, unitCost: null, acquiredOn: null },
      { quantity: 2, unitCost: 3, acquiredOn: "2026-01-05" },
    ]);
    expect(run.value?.snapshots[0]?.summary.marketSource).toBeNull();
    expect(run.ms).toBeLessThan(BUDGET_MS);
  });

  it("still reads the cells it always read", () => {
    const parsed = parseItemMarkdown(file({}));
    expect(parsed?.snapshots[0]?.summary).toMatchObject({ market: 9, marketSource: "Skinport" });
    expect(parsed?.snapshots[0]?.summary.quotes.map((q) => [q.source, q.price])).toEqual([["skinport", 1.2], ["csfloat", 4.15]]);
    expect(parsed?.sales[0]?.lots).toEqual([{ quantity: 1, unitCost: 5, acquiredOn: "2026-01-01" }]);
  });
});

/**
 * Short strings drawn from a few tokens by a seeded generator (mulberry32), so
 * a failure names an input that comes back on every run, and short enough that
 * the patterns the scans replaced stay quick on every one of them.
 */
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

/** The inputs on which a reader and the pattern it replaced disagree, the first few. */
function disagreements<T>(inputs: string[], read: (text: string) => T, before: (text: string) => T): string[] {
  return inputs.filter((text) => JSON.stringify(read(text)) !== JSON.stringify(before(text))).slice(0, 5);
}

describe("the scans read exactly what the patterns they replaced read", () => {
  // What exteriorFromName and splitName were before they scanned.
  const exteriorBefore = (name: string): string | null => {
    const match = /\(([^)]+)\)\s*$/.exec(name);
    if (!match) return null;
    const printed = (match[1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    return lookup(EXTERIOR_ALIASES, printed) ?? EXTERIOR_IDS.find((id) => id.replace(/_/g, "") === printed) ?? null;
  };
  const splitBefore = (name: string): { weapon: string | null; finish: string | null } => {
    const withoutWear = name.replace(/\s*\([^)]*\)\s*$/, "");
    const bar = withoutWear.indexOf("|");
    if (bar === -1) return { weapon: null, finish: null };
    const weapon = withoutWear.slice(0, bar).replace(/^★\s*/, "").replace(/^StatTrak™\s*/i, "").replace(/^Souvenir\s*/i, "").trim();
    return { weapon: weapon || null, finish: withoutWear.slice(bar + 1).trim() || null };
  };
  const tokens = ["(", ")", "()", ")(", " ", "  ", "\t", "\n", "\r", "\u2028", "\u2029", "\u00a0", "|", " | ", "★ ", "StatTrak™ ", "Souvenir ", "AK-47", "Crown", "(Foil)", "(Field-Tested)", "Field-Tested", "(FN)", "(Minimal Wear)", "x"];
  const names = [
    "Sticker | Crown (Foil) (Field-Tested)",
    "StatTrak™ AK-47 | Redline (Field-Tested)",
    "★ Karambit | Doppler (Factory New) ",
    "AK-47 | Case Hardened (Battle-Scarred)\n",
    "Sticker | (Holo) | Team (2026) (Minimal Wear)",
    ...drawn(tokens, 20_000, 2026),
  ];

  it("for the wear tier and the gun, with names of several bracketed groups and every kind of line break", () => {
    // The generator has to reach the cases that matter, or agreement says nothing.
    expect(names.filter((name) => exteriorBefore(name) !== null).length).toBeGreaterThan(500);
    expect(names.filter((name) => /\([^)]*\)[^(]*\([^)]*\)\s*$/.test(name) && exteriorBefore(name) !== null).length).toBeGreaterThan(50);
    expect(exteriorFromName("Sticker | Crown (Foil) (Field-Tested)")).toBe("field_tested");
    expect(splitName("Sticker | Crown (Foil) (Field-Tested)")).toEqual({ weapon: "Sticker", finish: "Crown (Foil)" });
    expect(disagreements(names, exteriorFromName, exteriorBefore)).toEqual([]);
    expect(disagreements(names, splitName, splitBefore)).toEqual([]);
  });
});

describe("reading a Steam inventory's names", () => {
  /** One untagged item, so its wear and its gun come from the name alone. */
  const read = (name: string) => {
    const description: SteamDescription = { classid: "1", instanceid: "0", market_hash_name: name, name, type: "Rifle", tradable: 1, marketable: 1, tags: [] };
    const [item] = parseInventory({ success: 1, descriptions: [description], assets: [{ assetid: "9", classid: "1", instanceid: "0", amount: "1" }], total_inventory_count: 1 }, "76561198000000001").items;
    return { exterior: item?.exterior ?? null, weapon: item?.weapon ?? null, finish: item?.finish ?? null };
  };

  it("reads a name of tens of thousands of brackets or spaces in linear time", () => {
    // The inventory kept the patterns the spreadsheet reader dropped: forty
    // thousand "(" in a name took two seconds there.
    for (const name of ["(".repeat(100_000), `AK-47 | ${"(".repeat(100_000)})`, `AK-47 | x${spaces(100_000)}(${spaces(100_000)}`]) {
      const run = timed(() => read(name));
      expect(run.value.exterior).toBeNull();
      expect(run.ms).toBeLessThan(BUDGET_MS);
    }
  });

  it("reads every name Steam writes as it did with its own patterns", () => {
    const before = (name: string) => {
      const worn = /\(([^)]+)\)\s*$/.exec(name);
      const printed = (worn?.[1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
      const withoutWear = name.replace(/\s*\([^)]*\)\s*$/, "");
      const bar = withoutWear.indexOf("|");
      const weapon = bar === -1 ? null : withoutWear.slice(0, bar).replace(/^★\s*/, "").replace(/^StatTrak™\s*/, "").replace(/^Souvenir\s*/, "").trim() || null;
      return {
        exterior: worn ? (EXTERIOR_IDS.find((id) => id.replace(/_/g, "") === printed) ?? null) : null,
        weapon,
        finish: bar === -1 ? null : withoutWear.slice(bar + 1).trim() || null,
      };
    };
    // Steam's own spellings: tiers in full, prefixes capitalised.
    const tokens = ["★ ", "StatTrak™ ", "Souvenir ", "AK-47", " | ", "|", "Redline", "Sticker", "Crown", "(Holo)", "(Foil)", "(Field-Tested)", "(Factory New)", "(Battle-Scarred)", "(", ")", " ", "\n"];
    const names = ["Sticker | Crown (Foil) (Field-Tested)", "★ StatTrak™ Karambit | Doppler (Factory New)", ...drawn(tokens, 20_000, 31)];
    expect(names.filter((name) => before(name).exterior !== null).length).toBeGreaterThan(500);
    expect(disagreements(names, read, before)).toEqual([]);
    // Where the scan reads more than Steam's patterns did, it reads what a spreadsheet's name says.
    expect(read("AK-47 | Redline (FN)")).toEqual({ exterior: "factory_new", weapon: "AK-47", finish: "Redline" });
    expect(read("stattrak™ AK-47 | Redline (Field-Tested)")).toEqual({ exterior: "field_tested", weapon: "AK-47", finish: "Redline" });
  });
});
