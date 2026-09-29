import { describe, expect, it } from "vitest";
import { finishOf, gradeValue, wearProfile } from "@/lib/wear";

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

describe("wear from a grade", () => {
  it("leaves a gem-mint card untouched", () => {
    for (const grade of [10, 9.5]) {
      const p = wearProfile({ seed: 42, grade });
      expect(p.count).toBe(0);
      expect(p.corners).toEqual([]);
      expect(p.edges).toEqual([]);
      expect(p.scratches).toEqual([]);
      expect(p.creases).toEqual([]);
      expect(p.dust).toEqual([]);
      expect(p.smudges).toEqual([]);
      expect(p.printLines).toEqual([]);
      expect(p.dents).toEqual([]);
      expect(p.stains).toEqual([]);
      expect(p.toning).toBe(0);
      expect(p.centering).toEqual({ dx: 0, dy: 0 });
    }
    expect(wearProfile({ seed: 42, grade: 10 }).gloss).toBe(1);
  });

  it("is the same card every time, and a different card for a different seed", () => {
    const a = wearProfile({ seed: 7, grade: 5 });
    const b = wearProfile({ seed: 7, grade: 5 });
    const c = wearProfile({ seed: 8, grade: 5 });
    expect(a).toEqual(b);
    expect(a.count).toBe(c.count);
    expect(a.scratches).not.toEqual(c.scratches);
  });

  it("never has fewer marks, less off-centring or more shine as the grade falls", () => {
    for (const seed of [1, 99, 123456]) {
      let previous = wearProfile({ seed, grade: 10 });
      for (const grade of [9.5, 9, 8.5, 8, 7, 6, 5, 4, 3, 2, 1.5, 1]) {
        const p = wearProfile({ seed, grade });
        expect(p.count).toBeGreaterThanOrEqual(previous.count);
        expect(p.gloss).toBeLessThanOrEqual(previous.gloss);
        expect(Math.hypot(p.centering.dx, p.centering.dy)).toBeGreaterThanOrEqual(Math.hypot(previous.centering.dx, previous.centering.dy));
        previous = p;
      }
      expect(previous.count).toBeGreaterThan(30);
      expect(previous.creases.length).toBe(2);
      expect(previous.corners.length).toBe(4);
      expect(previous.stains.length).toBe(2);
      expect(previous.printLines.length).toBe(2);
      expect(previous.dents.length).toBe(4);
    }
  });

  it("gives a damaged raw card creases and stains, a played one dents and a print line, and a near-mint one only dust", () => {
    const dmg = wearProfile({ seed: 3, grade: gradeValue(null, "DMG") });
    expect(dmg.creases.length).toBeGreaterThan(0);
    expect(dmg.stains.length).toBeGreaterThan(0);
    const mp = wearProfile({ seed: 3, grade: gradeValue(null, "MP") });
    expect(mp.creases).toEqual([]);
    expect(mp.stains).toEqual([]);
    expect(mp.dents.length).toBeGreaterThan(0);
    expect(mp.printLines.length).toBeGreaterThan(0);
    const nm = wearProfile({ seed: 3, grade: gradeValue(null, "NM") });
    expect(nm.scratches).toEqual([]);
    expect(nm.dents).toEqual([]);
    expect(nm.smudges).toEqual([]);
    expect(nm.dust.length).toBeGreaterThan(0);
  });

  it("keeps smudges and dents off the art, and puts a stain against an edge", () => {
    const inArt = (x: number, y: number) => x > 28 && x < 72 && y > 34 && y < 104;
    for (const seed of [21, 22, 23, 24]) {
      const p = wearProfile({ seed, grade: 1 });
      for (const m of p.smudges) expect(inArt(m.x, m.y)).toBe(false);
      for (const d of p.dents) expect(inArt(d.x, d.y)).toBe(false);
      for (const t of p.stains) expect(Math.min(t.x, 100 - t.x, t.y, 140 - t.y)).toBeLessThanOrEqual(7);
      for (const l of p.printLines) expect(l.y).toBeGreaterThan(0);
    }
  });

  it("only tones some cards, and never a gem-mint one", () => {
    const toned = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => wearProfile({ seed, grade: 4 }).toning);
    expect(toned.some((t) => t > 0.05)).toBe(true);
    expect(toned.every((t) => t <= 0.35)).toBe(true);
    expect(wearProfile({ seed: 1, grade: 10 }).toning).toBe(0);
  });

  it("keeps scratches out of the art and creases across a corner", () => {
    const p = wearProfile({ seed: 11, grade: 1 });
    const inArt = (x: number, y: number) => x > 28 && x < 72 && y > 34 && y < 104;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      for (const s of wearProfile({ seed, grade: 1 }).scratches) {
        expect(inArt(s.x1, s.y1)).toBe(false);
        expect(inArt(s.x2, s.y2)).toBe(false);
      }
    }
    for (const c of p.creases) {
      expect([0, 140]).toContain(c.y1);
      expect([0, 100]).toContain(c.x2);
    }
  });

  it("concentrates wear where the photo said it was, but not on a gem-mint card", () => {
    const plain = wearProfile({ seed: 5, grade: 7 });
    const soft = wearProfile({ seed: 5, grade: 7, assessment: { corners: "soft, some whitening" } });
    const scuffed = wearProfile({ seed: 5, grade: 7, assessment: { surface: "light scratches" } });
    expect(soft.corners.length).toBe(plain.corners.length + 1);
    expect(scuffed.scratches.length).toBe(plain.scratches.length + 2);
    expect(wearProfile({ seed: 5, grade: 10, assessment: { corners: "soft", surface: "scratched" } }).count).toBe(0);
    const offCentre = wearProfile({ seed: 5, grade: 8, assessment: { centering: "60/40 left to right" } });
    expect(Math.hypot(offCentre.centering.dx, offCentre.centering.dy)).toBeGreaterThan(0);
    expect(wearProfile({ seed: 5, grade: 7, assessment: { surface: "a fingerprint smudge" } }).smudges.length).toBe(plain.smudges.length + 1);
    expect(wearProfile({ seed: 5, grade: 7, assessment: { surface: "some dust" } }).dust.length).toBe(plain.dust.length + 3);
    expect(wearProfile({ seed: 5, grade: 7, assessment: { surface: "a print line" } }).printLines.length).toBe(plain.printLines.length + 1);
    const stained = wearProfile({ seed: 5, grade: 7, assessment: { surface: "yellowing and a stain" } });
    expect(stained.stains.length).toBe(plain.stains.length + 1);
    expect(stained.toning).toBeGreaterThanOrEqual(0.12);
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
  it("leaves every card without a finish exactly as it was before finishes existed", () => {
    // Taken from the code as it stood before peels and warp were added.
    const before = [
      { seed: 7, count: 36, toning: 0.193, dx: -3.038, corner0: 3, scratch0x: 66.929, dust0x: 52.933, stain0x: 42.023 },
      { seed: 42, count: 36, toning: 0.187, dx: 0.629, corner0: 2, scratch0x: 19.262, dust0x: 48.209, stain0x: 22.35 },
      { seed: 1234, count: 36, toning: 0.061, dx: -2.655, corner0: 2, scratch0x: 33.482, dust0x: 96.53, stain0x: 34.687 },
    ];
    const r = (n: number) => Math.round(n * 1000) / 1000;
    for (const b of before) {
      for (const finish of [null, "foil"] as const) {
        const p = wearProfile({ seed: b.seed, grade: 3, finish });
        expect(p.count - p.peels.length).toBe(b.count);
        expect(r(p.toning)).toBe(b.toning);
        expect(r(p.centering.dx)).toBe(b.dx);
        expect(p.corners[0]!.corner).toBe(b.corner0);
        expect(r(p.scratches[0]!.x1)).toBe(b.scratch0x);
        expect(r(p.dust[0]!.x)).toBe(b.dust0x);
        expect(r(p.stains[0]!.x)).toBe(b.stain0x);
      }
    }
  });

  it("peels only a finished card, only from grade 4 down, and never less as the grade falls", () => {
    for (const grade of [1, 2, 3, 4, 5, 8]) expect(wearProfile({ seed: 9, grade }).peels).toEqual([]);
    expect(wearProfile({ seed: 9, grade: 5, finish: "foil" }).peels).toEqual([]);
    expect(wearProfile({ seed: 9, grade: 4, finish: "holo" }).peels.length).toBe(1);
    expect(wearProfile({ seed: 9, grade: 2, finish: "reverse" }).peels.length).toBe(2);
    let previous = 0;
    for (const grade of [10, 8, 6, 4, 3, 2, 1]) {
      const n = wearProfile({ seed: 9, grade, finish: "refractor" }).peels.length;
      expect(n).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
  });

  it("silvers the edges of a finished card that has worn ones, and no other", () => {
    expect(wearProfile({ seed: 4, grade: 5, finish: "holo" }).silvering).toBe(true);
    expect(wearProfile({ seed: 4, grade: 5 }).silvering).toBe(false);
    expect(wearProfile({ seed: 4, grade: 10, finish: "holo" }).silvering).toBe(false);
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
