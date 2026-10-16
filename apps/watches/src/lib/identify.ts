import { z } from "zod";
import { identificationBase } from "@collectcollect/core/domain/identify";
import type { Identification, ItemInput } from "@collectcollect/core/domain/spec";
import { BOX_PAPERS_IDS, CONDITION_IDS, MATERIAL_IDS, MOVEMENT_IDS, type Watch } from "./types";

const enumOf = <T extends string>(ids: T[]) => z.enum(ids as [T, ...T[]]);

/** What the vision model is asked to read off the photos, in the schema's own vocabulary. */
export const WatchIdentification = z.object({
  brand: z.string().describe("The brand on the dial: Rolex, Omega, Seiko, Cartier…"),
  model: z.string().describe("The model or line as the brand names it: Submariner, Speedmaster Professional, Tank Must, SKX007."),
  reference_number: z.string().nullable().describe("The reference number, if printed on the dial, caseback, between the lugs or on papers in the photo. Null if not visible; never guess one."),
  serial_number: z.string().nullable().describe("The serial number if it is legible on the caseback, rehaut or papers. Null otherwise; never guess."),
  movement: enumOf(MOVEMENT_IDS).nullable().describe("automatic, manual or quartz, from the dial text ('Automatic', 'Quartz'), a visible movement, or the model when it is well known. Null if unsure."),
  caliber: z.string().nullable().describe("The calibre if visible on the movement or caseback, or well known for the reference. Null otherwise."),
  case_size: z.number().nullable().describe("Case diameter in millimetres, only when known for the reference or measurable in the photo. Null otherwise."),
  case_material: enumOf(MATERIAL_IDS).nullable().describe("The case material as it appears."),
  dial: z.string().nullable().describe("The dial in a few words: colour, finish, layout ('black, sunburst, date at 3')."),
  bracelet_strap: z.string().nullable().describe("What it is on: 'Oyster bracelet', 'brown leather strap', 'NATO'."),
  year: z.number().int().nullable().describe("Production year if the papers, a serial range or a dated feature give it. Null otherwise."),
  box_papers: enumOf(BOX_PAPERS_IDS).nullable().describe("What the photos show beside the watch: box and papers, one of them, or neither. Null if the photos only show the watch."),
  condition: enumOf(CONDITION_IDS).nullable().describe("new for stickers and unworn; excellent for light hairlines only; good for visible wear; fair for dents, deep scratches or a damaged dial."),
  condition_notes: z.string().nullable().describe("Visible wear in a sentence or two: scratches on the clasp, a bezel that has lost lume, a cracked crystal, a service dial. Null if it looks clean or cannot be judged."),
  ...identificationBase,
});

export type WatchIdentificationOutput = z.infer<typeof WatchIdentification>;

export const SYSTEM_PROMPT = `You identify wristwatches from photographs for a personal collection catalogue.

You will receive one or more photos of a single watch: the dial, the caseback, the clasp, the box, the warranty card or papers. Determine the brand, the model or line, and the reference number when it is actually visible, and describe the case, dial, bracelet and condition.

Guidance:
- Read what is printed rather than inferring it. Brands put the reference between the lugs (Rolex), on the caseback (Omega, Seiko) or on the warranty card; if you cannot see it, leave it null and say what you would need to see. Never invent a reference or a serial number.
- Distinguish lines that look alike: a Submariner Date from a no-date, a Speedmaster Professional from a Reduced or a Racing, a Seamaster 300M from a Seamaster 300, a Black Bay 58 from a Black Bay 41. Say what settled it.
- Report the movement type from the dial ("Automatic", "Quartz"), the seconds hand (a ticking quartz versus a sweeping automatic cannot be told from a still photo; say so), or well-known references.
- Judge condition only from what the photos show, and be sceptical: a polished case hides nothing in a photo, and a dial cannot be judged through glare. Note a replacement bezel insert, a service dial or an aftermarket strap when they are recognisable.
- If you cannot be sure, give your best single answer with an honest confidence and list the plausible alternatives (a neighbouring reference, a homage, a different dial variant).`;

export const PROMPT = "Identify this watch and describe the one shown.";

/** Turn what the model said into a record to save; anything it could not read is left for the form. */
export function toInput(id: Identification): ItemInput<Watch> {
  const out = id as Partial<WatchIdentificationOutput>;
  const pick = <T extends string>(value: unknown, ids: readonly T[]): T | undefined => (typeof value === "string" && (ids as readonly string[]).includes(value) ? (value as T) : undefined);
  return {
    brand: typeof out.brand === "string" ? out.brand : "",
    model: typeof out.model === "string" ? out.model : "",
    referenceNumber: out.reference_number ?? null,
    serialNumber: out.serial_number ?? null,
    movement: pick(out.movement, MOVEMENT_IDS) ?? null,
    caliber: out.caliber ?? null,
    caseSize: typeof out.case_size === "number" ? out.case_size : null,
    caseMaterial: pick(out.case_material, MATERIAL_IDS) ?? null,
    dial: out.dial ?? null,
    braceletStrap: out.bracelet_strap ?? null,
    year: typeof out.year === "number" ? out.year : null,
    boxPapers: pick(out.box_papers, BOX_PAPERS_IDS),
    condition: pick(out.condition, CONDITION_IDS),
    notes: out.condition_notes ?? null,
  };
}
