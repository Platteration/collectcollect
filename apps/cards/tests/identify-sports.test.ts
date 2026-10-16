import { describe, expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SYSTEM_PROMPT, normalize } from "@/lib/identify/claude";
import { IdentificationSchema } from "@/lib/identify/schema";
import type { Identification } from "@/lib/types";

const answer = (over: Partial<Identification> = {}, grading: Partial<Identification["grading"]> = {}): Identification => ({
  game: "sports", sport: "baseball", name: " Mike Trout ", set_name: "Topps Chrome", set_code: null, card_number: "US175", year: 2011, rarity: null, variant: null,
  language: "English", manufacturer: "Topps", subject: null, team: " Los Angeles Angels ", rookie: true, parallel: " Gold Refractor ", serial_number: " 12/50 ", autograph: false, relic: false,
  grading: { company: "BGS", grade: "9.5", cert_number: null, subgrades: { centering: 9.5, corners: 9, edges: 10, surface: 9.5 }, ...grading },
  condition_notes: null,
  condition_assessment: { centering: null, corners: null, edges: null, surface: null, estimated_grade_low: null, estimated_grade_high: null, caveat: null, centering_ratios: null },
  confidence: 0.9, alternatives: [], search_query: "2011 Topps Chrome Mike Trout US175", ...over,
});

describe("what the model is asked to read off a sports card", () => {
  it("asks for the team, the flags, the parallel, the numbering and the subgrades, every one of them required", () => {
    const { schema } = zodOutputFormat(IdentificationSchema) as unknown as { schema: { properties: Record<string, { properties?: Record<string, unknown> }>; required: string[] } };
    for (const key of ["team", "rookie", "parallel", "serial_number", "autograph", "relic"]) {
      expect(schema.properties, key).toHaveProperty(key);
      expect(schema.required, key).toContain(key);
    }
    expect(Object.keys(schema.properties.grading?.properties ?? {})).toEqual(["company", "grade", "cert_number", "subgrades"]);
    // The prompt says to read each of them, so the model is told as well as asked.
    for (const word of ["team", "rookie", "parallel", "serial numbering", "autograph", "relic", "subgrades"]) expect(SYSTEM_PROMPT.toLowerCase(), word).toContain(word);
  });

  it("takes an answer that has them, and refuses one that leaves the team out", () => {
    expect(IdentificationSchema.safeParse(answer()).success).toBe(true);
    const { team, ...without } = answer();
    void team;
    expect(IdentificationSchema.safeParse(without).success).toBe(false);
  });
});

describe("the identification the app keeps from the model's answer", () => {
  it("trims the sports text and keeps the flags as flags", () => {
    expect(normalize(answer())).toMatchObject({ name: "Mike Trout", team: "Los Angeles Angels", parallel: "Gold Refractor", serial_number: "12/50", rookie: true, autograph: false, relic: false });
    // Blank is no parallel, and an answer without the flags reads as a card with none of them.
    const { rookie, autograph, relic, ...bare } = answer({ parallel: "  ", serial_number: "", team: null });
    void [rookie, autograph, relic];
    expect(normalize(bare as Identification)).toMatchObject({ team: null, parallel: null, serial_number: null, rookie: false, autograph: false, relic: false });
  });

  it("holds the subgrades to the 1 to 10 scale, as a typed one is", () => {
    expect(normalize(answer()).grading.subgrades).toEqual({ centering: 9.5, corners: 9, edges: 10, surface: 9.5 });
    expect(normalize(answer({}, { subgrades: { centering: 95, corners: 0, edges: 9, surface: null } })).grading.subgrades).toEqual({ centering: null, corners: null, edges: 9, surface: null });
    expect(normalize(answer({}, { subgrades: { centering: null, corners: null, edges: null, surface: null } })).grading.subgrades).toBeNull();
    expect(normalize(answer({}, { subgrades: null })).grading.subgrades).toBeNull();
  });
});
