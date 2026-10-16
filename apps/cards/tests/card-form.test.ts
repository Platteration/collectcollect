import { describe, expect, it } from "vitest";
import { emptyForm, formFromCard, formToInput } from "@/components/CardForm";
import { formFromIdentification } from "@/components/AddCardFlow";
import { inputFromIdentification } from "@/lib/scan-types";
import { normalizeInput } from "@/lib/cards";
import type { Identification } from "@/lib/types";

/** What the vision model answers for a BGS slab of a numbered, autographed rookie card. */
const slab: Identification = {
  game: "sports", sport: "baseball", name: "Mike Trout", set_name: "Topps Chrome", set_code: null, card_number: "US175", year: 2011, rarity: null, variant: null,
  language: "English", manufacturer: "Topps", subject: null, team: "Los Angeles Angels", rookie: true, parallel: "Gold Refractor", serial_number: "12/50", autograph: true, relic: false,
  grading: { company: "BGS", grade: "9.5", cert_number: "0012345678", subgrades: { centering: 9.5, corners: 9, edges: 10, surface: 9.5 } },
  condition_notes: null,
  condition_assessment: {
    centering: "55/45", corners: null, edges: null, surface: null, estimated_grade_low: null, estimated_grade_high: null, caveat: null,
    centering_ratios: { front_lr: "55/45", front_tb: "52/48", back_lr: null, back_tb: null },
  },
  confidence: 0.9, alternatives: [], search_query: "2011 Topps Chrome Mike Trout US175",
};

describe("the card form's sports fields", () => {
  it("keeps the label's subgrades apart from the centering that was measured", () => {
    const form = formFromIdentification(slab);
    // Two different things that are both called centering: the border ratios, and the grade on the label.
    expect(form).toMatchObject({ centeringFrontLr: "55/45", centeringFrontTb: "52/48", subCentering: "9.5", subCorners: "9", subEdges: "10", subSurface: "9.5" });
    const input = formToInput(form);
    expect(input.centering).toEqual({ front: { lr: "55/45", tb: "52/48" }, back: { lr: null, tb: null } });
    expect(input.subgrades).toEqual({ centering: 9.5, corners: 9, edges: 10, surface: 9.5 });
    // Editing one never touches the other.
    expect(formToInput({ ...form, subCentering: "10" })).toMatchObject({ centering: input.centering, subgrades: { centering: 10 } });
    expect(formToInput({ ...form, centeringFrontLr: "60/40" })).toMatchObject({ subgrades: input.subgrades });
  });

  it("carries the team, the flags, the parallel and the numbering from an identification to the saved card, and back to the form", () => {
    const form = formFromIdentification(slab);
    expect(form).toMatchObject({ team: "Los Angeles Angels", rookie: "true", parallel: "Gold Refractor", serialNumber: "12/50", autograph: "true", relic: "" });
    const input = formToInput(form);
    expect(input).toMatchObject({ team: "Los Angeles Angels", rookie: true, parallel: "Gold Refractor", serialNumber: "12/50", autograph: true, relic: false });
    expect(formToInput(formFromCard(normalizeInput(input)))).toEqual(input);
    // The form and the scan inbox read an identification the same way.
    expect(inputFromIdentification(slab)).toMatchObject({ team: input.team, rookie: true, parallel: input.parallel, serialNumber: input.serialNumber, autograph: true, relic: false, subgrades: input.subgrades });
  });

  it("reads an identification made before the sports fields as a plain card", () => {
    const { team, rookie, parallel, serial_number, autograph, relic, ...older } = slab;
    void [team, rookie, parallel, serial_number, autograph, relic];
    const form = formFromIdentification({ ...older, grading: { company: "PSA", grade: "9", cert_number: null } });
    expect(form).toMatchObject({ team: "", rookie: "", parallel: "", serialNumber: "", autograph: "", relic: "", subCentering: "", subCorners: "", subEdges: "", subSurface: "" });
    expect(formToInput(form)).toMatchObject({ team: null, rookie: false, parallel: null, serialNumber: null, autograph: false, relic: false, subgrades: null });
  });

  it("starts empty, and an empty set of subgrades is none rather than four blanks", () => {
    const input = formToInput(emptyForm("sports"));
    expect(input).toMatchObject({ game: "sports", team: null, rookie: false, parallel: null, serialNumber: null, autograph: false, relic: false, subgrades: null });
    expect(formToInput({ ...emptyForm("sports"), subEdges: " 9.5 " }).subgrades).toEqual({ centering: null, corners: null, edges: 9.5, surface: null });
  });

  it("sends a subgrade as typed and lets the server decide whether it is one", () => {
    const typed = formToInput({ ...emptyForm("sports"), name: "x", subCentering: "11", subCorners: "nine", subEdges: "9", subSurface: "0" });
    expect(normalizeInput({ ...typed, game: "sports", name: "x" }).subgrades).toEqual({ centering: null, corners: null, edges: 9, surface: null });
  });
});
