import { describe, expect, it } from "vitest";
import { gradeValue, wearProfile } from "@/lib/wear";

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
      expect(previous.count).toBeGreaterThan(10);
      expect(previous.creases.length).toBe(2);
      expect(previous.corners.length).toBe(4);
    }
  });

  it("gives a damaged raw card creases and a played one none", () => {
    expect(wearProfile({ seed: 3, grade: gradeValue(null, "DMG") }).creases.length).toBeGreaterThan(0);
    expect(wearProfile({ seed: 3, grade: gradeValue(null, "MP") }).creases).toEqual([]);
    expect(wearProfile({ seed: 3, grade: gradeValue(null, "NM") }).scratches).toEqual([]);
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
  });
});
