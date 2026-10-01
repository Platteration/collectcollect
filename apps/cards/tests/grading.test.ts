import { describe, expect, it } from "vitest";
import {
  CENTERING_LIMITS,
  capsFor,
  centeringFromIdentification,
  centeringOffset,
  describeCentering,
  highestGradeAllowed,
  parseCentering,
  parseRatio,
  parseSide,
  worstAxis,
} from "@/lib/grading/centering";
import { agencyOf, isValidCert, reportUrlFor } from "@/lib/grading/agencies";
import { readCentering, readGradingReport } from "@/lib/grading/schema";
import { inputFromIdentification } from "@/lib/scan-types";
import { GRADING_AGENCIES, type Centering, type Identification } from "@/lib/types";

const c = (front: Partial<Centering["front"]> = {}, back: Partial<Centering["back"]> = {}): Centering => ({
  front: { lr: null, tb: null, ...front },
  back: { lr: null, tb: null, ...back },
});

describe("reading a centering ratio", () => {
  it("reads every way a grader writes a ratio and refuses the rest", () => {
    for (const text of ["55/45", "55 / 45", "55-45", "55–45", "55:45", "55 45", "55%/45%", "54L/46R".replace("54", "55").replace("46", "45"), "55"]) {
      expect(parseRatio(text), text).toEqual([55, 45]);
    }
    expect(parseRatio("49T/51B")).toEqual([49, 51]);
    expect(parseRatio("45/55")).toEqual([45, 55]); // direction is kept
    expect(parseRatio([60, 40])).toEqual([60, 40]);
    expect(parseRatio(60)).toEqual([60, 40]);
    expect(parseRatio("55.5/44.5")).toEqual([56, 44]);
    expect(parseRatio("60/41")).toEqual([60, 40]); // a point off from rounding is forgiven
    for (const blank of [null, undefined, "", "   ", []]) expect(parseRatio(blank)).toBeNull();
    for (const bad of ["60/45", "120/-20", "55/45/50", "abc", "55/", "101", [1, 2, 3]]) {
      expect(() => parseRatio(bad), String(bad)).toThrow(/add up to 100, like 55\/45/);
    }
  });

  it("reads a side the way a report prints it: one ratio, or both axes", () => {
    expect(parseSide("54L/46R 49T/51B")).toEqual({ lr: [54, 46], tb: [49, 51] });
    expect(parseSide("49T/51B 54L/46R")).toEqual({ lr: [54, 46], tb: [49, 51] });
    expect(parseSide("55/45 52/48")).toEqual({ lr: [55, 45], tb: [52, 48] });
    expect(parseSide("55/45")).toEqual({ lr: [55, 45], tb: null });
    expect(parseSide("55 45")).toEqual({ lr: [55, 45], tb: null });
    expect(parseSide("")).toEqual({ lr: null, tb: null });
    expect(() => parseSide("55/45 52/48 50/50")).toThrow(/add up to 100/);
  });

  it("reads the model's prose, each pair to the side and axis its clause names", () => {
    expect(parseCentering("60/40 left-right, 55/45 top-bottom")).toEqual(c({ lr: [60, 40], tb: [55, 45] }));
    expect(parseCentering("about 55/45")).toEqual(c({ lr: [55, 45] }));
    expect(parseCentering("Front 52/48 L/R and 50/50 T/B; back 70/30 left-right")).toEqual(c({ lr: [52, 48], tb: [50, 50] }, { lr: [70, 30] }));
    expect(parseCentering("front 54L/46R 49T/51B, back 45L/55R 49T/51B")).toEqual(c({ lr: [54, 46], tb: [49, 51] }, { lr: [45, 55], tb: [49, 51] }));
    expect(parseCentering("roughly 60/40 and 55/45")).toEqual(c({ lr: [60, 40], tb: [55, 45] }));
    expect(parseCentering("well centered")).toBeNull();
    expect(parseCentering("4/102 on the number line")).toBeNull(); // not a ratio: the pair does not add up
    expect(parseCentering(null)).toBeNull();
  });

  it("takes an identification's ratios first, then whatever its prose says", () => {
    const id = (assessment: Partial<NonNullable<Identification["condition_assessment"]>>): Identification =>
      ({
        game: "pokemon",
        name: "Charizard",
        grading: { company: null, grade: null, cert_number: null },
        condition_assessment: { centering: null, corners: null, edges: null, surface: null, estimated_grade_low: null, estimated_grade_high: null, caveat: null, ...assessment },
      }) as unknown as Identification;
    expect(centeringFromIdentification(id({ centering: "60/40 left-right", centering_ratios: { front_lr: "55/45", front_tb: "52/48", back_lr: null, back_tb: "not sure" } }))).toEqual(
      c({ lr: [55, 45], tb: [52, 48] }),
    );
    expect(centeringFromIdentification(id({ centering: "60/40 left-right", centering_ratios: { front_lr: null, front_tb: null, back_lr: null, back_tb: null } }))).toEqual(c({ lr: [60, 40] }));
    expect(centeringFromIdentification(id({ centering: "well centered" }))).toBeNull();
    expect(centeringFromIdentification(null)).toBeNull();
    // What a scan saves starts from the same reading.
    expect(inputFromIdentification(id({ centering: "70/30 top-bottom" })).centering).toEqual(c({ tb: [70, 30] }));
  });

  it("describes a centering and names its worst axis", () => {
    const measured = c({ lr: [55, 45], tb: [52, 48] }, { lr: [70, 30] });
    expect(describeCentering(measured)).toBe("front 55/45 left-right, 52/48 top-bottom; back 70/30 left-right");
    expect(worstAxis(measured)).toEqual({ side: "back", axis: "lr", ratio: [70, 30] });
    expect(worstAxis(c({ lr: [40, 60], tb: [55, 45] }))).toEqual({ side: "front", axis: "lr", ratio: [40, 60] });
    expect(worstAxis(c())).toBeNull();
  });
});

describe("what a centering lets a card grade", () => {
  it("walks each company's published limits, front and back, TCG against sports for TAG", () => {
    expect(highestGradeAllowed("PSA", c({ lr: [55, 45] }))).toMatchObject({ company: "PSA", grade: 10, label: "PSA 10", reason: "front 55/45 left-right" });
    expect(highestGradeAllowed("PSA", c({ lr: [56, 44] }))).toMatchObject({ grade: 9, label: "PSA 9" });
    // The back counts when it is known: 80/20 fails a 10's 75/25 and passes a 9's 90/10.
    expect(highestGradeAllowed("PSA", c({ lr: [55, 45] }, { lr: [80, 20] }))).toMatchObject({ grade: 9, reason: "back 80/20 left-right" });
    expect(highestGradeAllowed("PSA", c({ lr: [55, 45] }, { lr: [92, 8] }))).toMatchObject({ grade: 2, reason: "back 92/8 left-right" });
    expect(highestGradeAllowed("psa", c({ lr: [60, 40] }))).toMatchObject({ grade: 9 });
    expect(highestGradeAllowed("PSA", c({ lr: [95, 5] }))).toMatchObject({ grade: 2, label: "PSA 2" });
    expect(highestGradeAllowed("TAG", c({ lr: [55, 45] }, { lr: [68, 32] }), "pokemon")).toMatchObject({ grade: 9, label: "TAG 9" });
    expect(highestGradeAllowed("TAG", c({ lr: [55, 45] }, { lr: [68, 32] }), "sports")).toMatchObject({ grade: 10, label: "TAG Gem Mint 10" });
    expect(highestGradeAllowed("TAG", c({ lr: [51, 49] }, { lr: [52, 48] }), "mtg")).toMatchObject({ label: "TAG Pristine 10" });
    expect(highestGradeAllowed("CGC", c({ lr: [52, 48] }))).toMatchObject({ grade: 10, label: "CGC Pristine 10" });
    expect(highestGradeAllowed("CGC", c({ lr: [55, 45] }))).toMatchObject({ label: "CGC Gem Mint 10" });
    expect(highestGradeAllowed("BGS", c({ lr: [60, 40] }, { tb: [63, 37] }))).toMatchObject({ grade: 9, label: "BGS 9" });
    // Nothing to judge by: no company, no front measurement, no limits for the company.
    expect(highestGradeAllowed("Other", c({ lr: [60, 40] }))).toBeNull();
    expect(highestGradeAllowed(null, c({ lr: [60, 40] }))).toBeNull();
    expect(highestGradeAllowed("PSA", c({}, { lr: [60, 40] }))).toBeNull();
    expect(highestGradeAllowed("PSA", null)).toBeNull();
    expect(highestGradeAllowed("AGS", c({ lr: [60, 40] }))).toBeNull();
  });

  it("gives one cap per company that publishes limits, each marked approximate with its source", () => {
    const caps = capsFor(c({ lr: [60, 40] }), "pokemon");
    expect(caps.map((cap) => cap.label)).toEqual(["PSA 9", "BGS 9", "CGC 9", "SGC 9", "TAG 9", "ACE 10"]);
    for (const id of GRADING_AGENCIES) {
      const limits = CENTERING_LIMITS[id];
      if (!limits) continue;
      expect(limits.official, id).toMatch(/^https:\/\//);
      expect(limits.note, id).toMatch(/Approximate/);
      // Best grade first, so the walk stops at the first row the card passes.
      expect(limits.rows.map((r) => r.grade)).toEqual([...limits.rows.map((r) => r.grade)].sort((a, b) => b - a));
    }
    expect(capsFor(null)).toEqual([]);
  });

  it("shifts the 3D print by the front's measured ratios, up to four percent, and not at all when nothing is measured", () => {
    expect(centeringOffset(c({ lr: [60, 40] }))).toEqual({ dx: 3, dy: 0 });
    expect(centeringOffset(c({ lr: [40, 60], tb: [55, 45] }))).toEqual({ dx: -3, dy: 1.5 });
    expect(centeringOffset(c({ lr: [90, 10] }))).toEqual({ dx: 4, dy: 0 });
    expect(centeringOffset(c({}, { lr: [60, 40] }))).toBeNull();
    expect(centeringOffset(null)).toBeNull();
  });
});

describe("the agencies and their reports", () => {
  it("puts a cert in the link only when it has the company's shape", () => {
    expect(reportUrlFor("TAG", "a1234567")).toBe("https://my.taggrading.com/card/A1234567");
    expect(reportUrlFor("TAG", "../x")).toBe("https://taggrading.com/pages/cert-search");
    expect(reportUrlFor("PSA", "12345678")).toBe("https://www.psacard.com/cert/12345678/psa");
    expect(reportUrlFor("PSA", "1234")).toBe("https://www.psacard.com/cert");
    expect(reportUrlFor("CGC", "6049562103")).toBe("https://www.cgccards.com/certlookup/6049562103/");
    expect(reportUrlFor("BGS", "0012345678")).toBe("https://www.beckett.com/grading/card-lookup?item_type=BGS&item_id=12345678");
    expect(reportUrlFor("SGC", "1234567")).toBe("https://www.gosgc.com/cert-code-lookup");
    expect(reportUrlFor("ACE", "338603")).toBe("https://acegrading.com/cert/338603");
    expect(reportUrlFor("AGS", "809444")).toBe("https://agscard.com/feed/00809444/view");
    expect(reportUrlFor("Other", "123")).toBeNull();
    expect(reportUrlFor(null, "123")).toBeNull();
    expect(isValidCert("TAG", "V1234567")).toBe(true);
    expect(isValidCert("TAG", "12345678")).toBe(false);
    expect(isValidCert("SGC", "ABCDEFG-123")).toBe(true);
    expect(agencyOf("tag")?.id).toBe("TAG");
    expect(agencyOf("constructor")).toBeNull();
  });
});

describe("what a stored centering or report may look like", () => {
  it("reads centering from text per axis, a whole side in one box, or the stored pairs, and refuses what is not a ratio", () => {
    expect(readCentering({ front: { lr: "55/45", tb: "" }, back: { lr: null } })).toEqual(c({ lr: [55, 45] }));
    expect(readCentering({ front: { lr: "54L/46R 49T/51B" }, back: "45L/55R" })).toEqual(c({ lr: [54, 46], tb: [49, 51] }, { lr: [45, 55] }));
    expect(readCentering({ front: { lr: [55, 45], tb: null }, back: { lr: null, tb: null } })).toEqual(c({ lr: [55, 45] }));
    expect(readCentering("60/40 55/45")).toEqual(c({ lr: [60, 40], tb: [55, 45] }));
    expect(readCentering({ front: { lr: "", tb: "" }, back: { lr: "", tb: "" } })).toBeNull();
    expect(readCentering(null)).toBeNull();
    expect(() => readCentering({ front: { lr: "60/45" } })).toThrow(/add up to 100/);
    expect(() => readCentering(42)).toThrow(/add up to 100/);
  });

  it("fills a report out and refuses one that is not a report, naming the field", () => {
    const report = readGradingReport({ company: "tag", cert: "A1234567", source: "manual", checkedAt: "2026-10-01T00:00:00.000Z", grade: "10", label: "", tag: { score: "973", rollups: { centering: 990 } } });
    expect(report).toMatchObject({ company: "TAG", label: null, grade: "10", subgrades: null, population: null, images: null, identity: null, url: null });
    expect(report?.tag).toEqual({
      score: 973,
      rollups: { centering: 990, corners: null, edges: null, surface: null },
      composite: { front: null, back: null },
      dings: { cornersFront: null, cornersBack: null, edgesFront: null, edgesBack: null, surfaceFront: null, surfaceBack: null },
    });
    const bgs = readGradingReport({ company: "BGS", cert: "1", source: "manual", checkedAt: "2026-10-01", subgrades: { centering: { front: 9.5 }, corners: { front: 10 } } });
    expect(bgs?.subgrades).toEqual({ centering: { front: 9.5, back: null }, corners: { front: 10, back: null }, edges: { front: null, back: null }, surface: { front: null, back: null } });
    expect(readGradingReport(null)).toBeNull();
    expect(() => readGradingReport({ company: "TAG", cert: "A1", source: "manual", checkedAt: "2026-10-01", tag: { score: 5000 } })).toThrow(/grading report.*tag\.score/);
    expect(() => readGradingReport({ company: "Other", cert: "1", source: "manual", checkedAt: "2026-10-01" })).toThrow(/grading report.*company/);
    expect(() => readGradingReport({ company: "PSA", cert: "1", source: "psa", checkedAt: "2026-10-01", images: { front: "http://images.psacard.com/x.jpg" } })).toThrow(/https/);
    expect(() => readGradingReport({ company: "PSA", cert: "", source: "psa", checkedAt: "2026-10-01" })).toThrow(/cert/);
  });
});
