import { describe, expect, it } from "vitest";
import { MARK_KINDS, finishOf, gradeValue, hash32, holoPattern, markBudget, unit, wearProfile, type HoloPattern, type MarkKind } from "@/lib/wear";

describe("reading a grade", () => {
  it("takes the number a grade carries, and the last one when there are several", () => {
    expect(gradeValue("10", "NM")).toBe(10);
    expect(gradeValue("9.5", "NM")).toBe(9.5);
    expect(gradeValue("PSA 10", "DMG")).toBe(10);
    expect(gradeValue("BGS 9.5 Black Label", "NM")).toBe(9.5);
    expect(gradeValue("1st Edition 9", "NM")).toBe(9);
    expect(gradeValue("12", "NM")).toBe(10);
    expect(gradeValue("0", "MP")).toBe(5);
  });

  it("treats an authentic-only slab as a mid card and falls back to the condition otherwise", () => {
    expect(gradeValue("Authentic", "NM")).toBe(6);
    expect(gradeValue("A", "NM")).toBe(6);
    expect(gradeValue(null, "NM")).toBe(9);
    expect(gradeValue("", "LP")).toBe(7);
    expect(gradeValue("gem mint", "HP")).toBe(3);
    expect(gradeValue(null, "DMG")).toBe(1.5);
  });
});

const KEY: Record<MarkKind, keyof ReturnType<typeof wearProfile>> = {
  dust: "dust",
  smudge: "smudges",
  printLine: "printLines",
  corner: "corners",
  edge: "edges",
  scratch: "scratches",
  dent: "dents",
  stain: "stains",
  crease: "creases",
  peel: "peels",
};
const counts = (p: ReturnType<typeof wearProfile>) => Object.fromEntries(MARK_KINDS.map((k) => [k, (p[KEY[k]] as unknown[]).length])) as Record<MarkKind, number>;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("the hash every choice is made from", () => {
  it("is the same for the same parts, in [0, 1), and different for different parts", () => {
    expect(hash32(7, "kind", 3)).toBe(hash32(7, "kind", 3));
    expect(hash32(7, "kind", 3)).not.toBe(hash32(7, "kind", 4));
    expect(hash32(7, "kind", 3)).not.toBe(hash32(8, "kind", 3));
    // The separator keeps "1","23" apart from "12","3".
    expect(hash32(1, 23)).not.toBe(hash32(12, 3));
    for (const seed of seeds(500)) {
      const u = unit(seed, "x");
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
    // Neighbouring ids spread across the range rather than clustering.
    const buckets = new Array(10).fill(0);
    for (const seed of seeds(5000)) buckets[Math.floor(unit(seed, "pattern") * 10)]++;
    for (const b of buckets) expect(b).toBeGreaterThan(400);
  });
});

describe("wear from a grade", () => {
  it("leaves a gem-mint card untouched", () => {
    for (const grade of [10, 9.5]) {
      const p = wearProfile({ seed: 42, grade, finish: "holo" });
      expect(p.count).toBe(0);
      for (const k of MARK_KINDS) expect(p[KEY[k]]).toEqual([]);
      expect(p.toning).toBe(0);
      expect(p.centering).toEqual({ dx: 0, dy: 0 });
    }
    expect(wearProfile({ seed: 42, grade: 10 }).gloss).toBe(1);
  });

  it("is the same card every time", () => {
    expect(wearProfile({ seed: 7, grade: 5, finish: "foil" })).toEqual(wearProfile({ seed: 7, grade: 5, finish: "foil" }));
  });

  it("spends the grade's budget in full, so a lower grade never has fewer marks", () => {
    for (const seed of [1, 99, 123456]) {
      let previous = wearProfile({ seed, grade: 10 });
      for (const grade of [9.5, 9, 8.5, 8, 7, 6, 5, 4, 3, 2, 1.5, 1]) {
        const p = wearProfile({ seed, grade });
        expect(p.count).toBe(markBudget(grade));
        expect(p.count).toBeGreaterThanOrEqual(previous.count);
        expect(p.gloss).toBeLessThanOrEqual(previous.gloss);
        expect(Math.abs(p.centering.dx)).toBeLessThanOrEqual(4);
        expect(Math.abs(p.centering.dy)).toBeLessThanOrEqual(4);
        previous = p;
      }
      expect(previous.count).toBe(40);
    }
  });

  it("gives two cards of the same grade different kinds of wear", () => {
    const signatures = new Set(seeds(30).map((seed) => JSON.stringify(counts(wearProfile({ seed, grade: 5 })))));
    expect(signatures.size).toBeGreaterThan(15);
  });

  it("weights the kinds by grade: no stain, dent, crease or peel above its grade, mostly dust on a 9", () => {
    const total = Object.fromEntries(MARK_KINDS.map((k) => [k, 0])) as Record<MarkKind, number>;
    for (const seed of seeds(400)) {
      for (const [grade, kind] of [[8.5, "dent"], [6, "stain"], [4, "crease"], [6, "peel"]] as const) {
        expect(counts(wearProfile({ seed, grade, finish: "holo" }))[kind]).toBe(0);
      }
      const c = counts(wearProfile({ seed, grade: 9 }));
      for (const k of MARK_KINDS) total[k] += c[k];
    }
    const top = MARK_KINDS.reduce((a, b) => (total[a] >= total[b] ? a : b));
    expect(top).toBe("dust");
  });

  it("creases every card of a 2 or worse, peels every finished one, and stains only some of a 3", () => {
    let stained = 0;
    for (const seed of seeds(400)) {
      expect(counts(wearProfile({ seed, grade: 2 })).crease).toBeGreaterThanOrEqual(1);
      expect(counts(wearProfile({ seed, grade: 1.5, finish: "foil" })).peel).toBeGreaterThanOrEqual(1);
      if (counts(wearProfile({ seed, grade: 3 })).stain > 0) stained++;
    }
    // Roughly half: a card's own leaning decides, not the grade alone.
    expect(stained).toBeGreaterThan(120);
    expect(stained).toBeLessThan(300);
  });

  it("never gives a card more of a kind than it can carry", () => {
    for (const seed of seeds(300)) {
      const p = wearProfile({ seed, grade: 1, finish: "reverse", assessment: { corners: "soft", surface: "print line" } });
      const c = counts(p);
      expect(c.corner).toBeLessThanOrEqual(4);
      expect(c.peel).toBeLessThanOrEqual(2);
      expect(c.crease).toBeLessThanOrEqual(2);
      expect(c.printLine).toBeLessThanOrEqual(3);
      expect(new Set(p.corners.map((x) => x.corner)).size).toBe(p.corners.length);
      expect(new Set(p.peels.map((x) => x.corner)).size).toBe(p.peels.length);
    }
  });

  it("keeps a mark where it was when the card around it changes", () => {
    // The first scratch is found by its own name, so more dust or dents at a
    // lower grade does not move it; only its length follows the grade.
    let compared = 0;
    for (const seed of seeds(40)) {
      const a = wearProfile({ seed, grade: 4 }).scratches[0];
      const b = wearProfile({ seed, grade: 2 }).scratches[0];
      if (!a || !b) continue;
      expect([b.x1, b.y1]).toEqual([a.x1, a.y1]);
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });

  it("keeps smudges, dents and scratches off the art, a stain against an edge, and a crease across a corner", () => {
    const inArt = (x: number, y: number) => x > 28 && x < 72 && y > 34 && y < 104;
    for (const seed of seeds(40)) {
      const p = wearProfile({ seed, grade: 1 });
      for (const m of p.smudges) expect(inArt(m.x, m.y)).toBe(false);
      for (const d of p.dents) expect(inArt(d.x, d.y)).toBe(false);
      for (const s of p.scratches) {
        expect(inArt(s.x1, s.y1)).toBe(false);
        expect(inArt(s.x2, s.y2)).toBe(false);
      }
      for (const t of p.stains) expect(Math.min(t.x, 100 - t.x, t.y, 140 - t.y)).toBeLessThanOrEqual(7);
      for (const c of p.creases) {
        expect([0, 140]).toContain(c.y1);
        expect([0, 100]).toContain(c.x2);
      }
    }
  });

  it("only tones some cards, and never a gem-mint one", () => {
    const toned = seeds(10).map((seed) => wearProfile({ seed, grade: 4 }).toning);
    expect(toned.some((t) => t > 0.05)).toBe(true);
    expect(toned.every((t) => t <= 0.35)).toBe(true);
    expect(wearProfile({ seed: 1, grade: 10 }).toning).toBe(0);
  });

  it("makes the kinds the photo showed likelier, but gives a gem-mint card nothing", () => {
    const mean = (assessment: Parameters<typeof wearProfile>[0]["assessment"], kind: MarkKind) =>
      seeds(200).reduce((sum, seed) => sum + counts(wearProfile({ seed, grade: 7, assessment }))[kind], 0) / 200;
    expect(mean({ corners: "soft, some whitening" }, "corner")).toBeGreaterThan(mean(null, "corner") * 1.3);
    expect(mean({ surface: "light scratches" }, "scratch")).toBeGreaterThan(mean(null, "scratch") * 1.3);
    expect(mean({ surface: "a fingerprint smudge" }, "smudge")).toBeGreaterThan(mean(null, "smudge") * 1.3);
    expect(mean({ surface: "a print line" }, "printLine")).toBeGreaterThan(mean(null, "printLine") * 1.3);
    expect(wearProfile({ seed: 5, grade: 10, assessment: { corners: "soft", surface: "scratched, dusty, a stain" } }).count).toBe(0);
    expect(wearProfile({ seed: 5, grade: 7, assessment: { surface: "yellowing" } }).toning).toBeGreaterThanOrEqual(0.12);
    const offCentre = wearProfile({ seed: 5, grade: 8, assessment: { centering: "60/40 left to right" } });
    expect(Math.hypot(offCentre.centering.dx, offCentre.centering.dy)).toBeGreaterThan(0);
  });
});

describe("a holo card's pattern", () => {
  const PATTERNS: HoloPattern[] = ["sheen", "stripes", "cosmos", "cracked-ice", "starlight"];
  const share = (grade: number, which: HoloPattern[]) =>
    seeds(2000).filter((seed) => which.includes(holoPattern({ seed, grade, finish: "holo" })!)).length / 2000;

  it("is nothing without a finish and the same every time with one", () => {
    expect(holoPattern({ seed: 3, grade: 10, finish: null })).toBeNull();
    expect(holoPattern({ seed: 3, grade: 6, finish: "foil" })).toBe(holoPattern({ seed: 3, grade: 6, finish: "foil" }));
  });

  it("can be any of the five on a gem-mint card, the fancy ones likelier there and the plain sheen on a played one", () => {
    const seen = new Set(seeds(2000).map((seed) => holoPattern({ seed, grade: 10, finish: "holo" })));
    for (const p of PATTERNS) expect(seen.has(p)).toBe(true);
    expect(share(10, ["cracked-ice", "starlight"])).toBeGreaterThan(share(2, ["cracked-ice", "starlight"]) + 0.2);
    expect(share(2, ["sheen"])).toBeGreaterThan(share(10, ["sheen"]) + 0.3);
  });
});

describe("a card's finish", () => {
  it("is read from the variant, then the rarity", () => {
    expect(finishOf({ variant: "holo" })).toBe("holo");
    expect(finishOf({ variant: "Reverse Holo" })).toBe("reverse");
    expect(finishOf({ variant: "1st Edition Holofoil" })).toBe("holo");
    expect(finishOf({ variant: "Etched Foil" })).toBe("foil");
    expect(finishOf({ variant: "foil" })).toBe("foil");
    expect(finishOf({ variant: "Gold Refractor /50" })).toBe("refractor");
    expect(finishOf({ variant: "Prizm Silver" })).toBe("refractor");
    expect(finishOf({ variant: null, rarity: "Holo Rare" })).toBe("holo");
    expect(finishOf({ variant: "1st edition", rarity: "Rare Holo" })).toBe("holo");
  });

  it("is nothing when neither says so, and never reverse from a rarity alone", () => {
    expect(finishOf({ variant: "1st edition" })).toBeNull();
    expect(finishOf({ variant: "shadowless", rarity: "Rare" })).toBeNull();
    expect(finishOf({ rarity: "Mythic" })).toBeNull();
    expect(finishOf({ rarity: "Ultra Rare" })).toBeNull();
    expect(finishOf({ rarity: "Reverse Holo" })).toBe("holo");
    expect(finishOf({})).toBeNull();
  });
});

describe("wear on a finished card", () => {
  it("silvers the edges of a finished card that has worn ones, and no other", () => {
    const withEdges = seeds(50).find((seed) => wearProfile({ seed, grade: 5 }).edges.length > 0)!;
    expect(wearProfile({ seed: withEdges, grade: 5, finish: "holo" }).silvering).toBe(true);
    expect(wearProfile({ seed: withEdges, grade: 5 }).silvering).toBe(false);
    expect(wearProfile({ seed: withEdges, grade: 10, finish: "holo" }).silvering).toBe(false);
  });

  it("curls a raw card as it wears, a foil one sooner, and never one in a slab", () => {
    const tilt = (p: ReturnType<typeof wearProfile>) => Math.abs(p.warp.degrees);
    expect(tilt(wearProfile({ seed: 2, grade: 10 }))).toBe(0);
    expect(tilt(wearProfile({ seed: 2, grade: 6 }))).toBe(0);
    expect(tilt(wearProfile({ seed: 2, grade: 3 }))).toBeGreaterThan(0);
    expect(tilt(wearProfile({ seed: 2, grade: 7, finish: "foil" }))).toBeGreaterThanOrEqual(1.5);
    expect(tilt(wearProfile({ seed: 2, grade: 9, finish: "foil" }))).toBe(0);
    for (const grade of [1, 3, 5, 7, 9]) expect(tilt(wearProfile({ seed: 2, grade, finish: "holo", graded: true }))).toBe(0);
    for (const seed of [2, 3, 50]) {
      for (const finish of [null, "holo"] as const) {
        let previous = 0;
        for (const grade of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
          const d = tilt(wearProfile({ seed, grade, finish }));
          expect(d).toBeGreaterThanOrEqual(previous);
          expect(d).toBeLessThanOrEqual(4.5);
          previous = d;
        }
      }
    }
  });
});
