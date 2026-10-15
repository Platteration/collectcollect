import { z } from "zod";
import { identificationBase } from "@collectcollect/core/domain/identify";
import type { Identification, ItemInput } from "@collectcollect/core/domain/spec";
import { PACKAGING_IDS, REGION_IDS, type Bottle } from "./types";

const enumOf = <T extends string>(ids: T[]) => z.enum(ids as [T, ...T[]]);

/** What the vision model is asked to read off the photos, in the schema's own vocabulary. */
export const BottleIdentification = z.object({
  distillery: z.string().describe("The distillery or brand on the label: Ardbeg, Buffalo Trace, Yamazaki."),
  expression: z.string().describe("The expression as the label names it: 'Uigeadail', '12 Year Old', 'Cask Strength Batch 12'. For an age-statement bottling with no other name, the age: '18 Year Old'."),
  age_statement: z.number().int().nullable().describe("The age on the label in years, else null (no-age-statement)."),
  vintage: z.number().int().nullable().describe("The distillation year if printed, else null."),
  bottling_year: z.number().int().nullable().describe("The bottling year if printed or given by a lot code you can read with confidence, else null."),
  cask_type: z.string().nullable().describe("Cask wood and finish as the label says: 'ex-bourbon', 'oloroso sherry finish', 'refill hogshead'. Null if not stated."),
  abv: z.number().nullable().describe("Alcohol by volume in percent, as printed."),
  bottle_size: z.number().int().nullable().describe("Bottle size in millilitres as printed (700, 750, 1000, 500). Null if not visible."),
  bottle_number: z.string().nullable().describe("A bottle number ('Bottle 123 of 2000') or batch ('Batch 12') as printed, else null."),
  region: enumOf(REGION_IDS).nullable().describe("The Scotch region or the country, from the label."),
  packaging: enumOf(PACKAGING_IDS).nullable().describe("What the photos show the bottle came in: a tube, a box, or none. Null if only the bottle is shown."),
  sealed: z.boolean().nullable().describe("True when the capsule, wax or seal is visibly intact; false when it is broken or the level is clearly down; null when the photo cannot tell."),
  fill_level: z.number().int().nullable().describe("For an opened or old bottle, the fill as a percentage of a full bottle, judged from the level against the shoulder and neck; null when it looks full or cannot be judged."),
  condition_notes: z.string().nullable().describe("Label damage, a torn tube, a stained box, capsule corrosion, sediment. Null if it looks clean or cannot be judged."),
  ...identificationBase,
});

export type BottleIdentificationOutput = z.infer<typeof BottleIdentification>;

export const SYSTEM_PROMPT = `You identify bottles of whisky (and other spirits) from photographs for a personal collection catalogue.

You will receive one or more photos of a single bottle: the front label, the back label, the neck and capsule, a tube or box. Determine the distillery or brand, the exact expression, the age statement, the strength, the size, any vintage, bottling year, cask, bottle or batch number the label gives, and whether the bottle is sealed.

Guidance:
- Read the label rather than inferring. A bottling year often has to be read from a lot code (L…) on the back label or the glass; give it only when you can actually read it. Never invent a batch or bottle number.
- Distinguish releases that look alike: a current 10 Year Old from a 1990s one by label design and strength, a distillery bottling from an independent one (the bottler's name on the label), a travel-retail size from the standard one.
- Say sealed only when the capsule or seal is visibly intact. Judge the fill level against the shoulder and neck for an opened or older bottle, and say so when the photo cannot show it.
- Judge condition only from what the photos show: a torn label, a stained tube, a corroded capsule, sediment.
- If you cannot be sure, give your best single answer with an honest confidence and list the plausible alternatives (a neighbouring batch, a different age, a rebranded release).`;

export const PROMPT = "Identify this bottle and describe the one shown.";

/** Turn what the model said into a record to save; anything it could not read is left for the form. */
export function toInput(id: Identification): ItemInput<Bottle> {
  const out = id as Partial<BottleIdentificationOutput>;
  const pick = <T extends string>(value: unknown, ids: readonly T[]): T | undefined => (typeof value === "string" && (ids as readonly string[]).includes(value) ? (value as T) : undefined);
  return {
    distillery: typeof out.distillery === "string" ? out.distillery : "",
    expression: typeof out.expression === "string" ? out.expression : "",
    ageStatement: typeof out.age_statement === "number" ? out.age_statement : null,
    vintage: typeof out.vintage === "number" ? out.vintage : null,
    bottlingYear: typeof out.bottling_year === "number" ? out.bottling_year : null,
    caskType: out.cask_type ?? null,
    abv: typeof out.abv === "number" ? out.abv : null,
    bottleSize: typeof out.bottle_size === "number" ? out.bottle_size : undefined,
    bottleNumber: out.bottle_number ?? null,
    region: pick(out.region, REGION_IDS) ?? null,
    packaging: pick(out.packaging, PACKAGING_IDS),
    sealed: typeof out.sealed === "boolean" ? out.sealed : undefined,
    fillLevel: typeof out.fill_level === "number" ? out.fill_level : null,
    notes: out.condition_notes ?? null,
  };
}
