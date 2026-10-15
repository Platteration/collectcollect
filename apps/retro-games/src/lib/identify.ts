import { z } from "zod";
import { identificationBase } from "@collectcollect/core/domain/identify";
import type { Identification, ItemInput } from "@collectcollect/core/domain/spec";
import { COMPANY_IDS, CONDITION_IDS, COMPLETENESS_IDS, PLATFORM_IDS, REGION_IDS, type Game } from "./types";

const enumOf = <T extends string>(ids: T[]) => z.enum(ids as [T, ...T[]]);
const condition = enumOf(CONDITION_IDS).nullable();

/** What the vision model is asked to read off the photos, in the schema's own vocabulary. */
export const GameIdentification = z.object({
  title: z.string().describe("The game's title as printed on the label, box or spine, without the platform name."),
  platform: enumOf(PLATFORM_IDS).nullable().describe("The system it runs on, from the cartridge shape, disc branding, box logos or the rating label. Null if it cannot be told."),
  region: enumOf(REGION_IDS).nullable().describe("ntsc_u for North American releases (ESRB rating), pal for Europe and Australia (PEGI, USK, ELSPA, OFLC), ntsc_j for Japan (CERO, Japanese text). Null if unclear."),
  release_year: z.number().int().nullable().describe("The copyright or release year printed on it, else null."),
  publisher: z.string().nullable().describe("The publisher on the label or box (Nintendo, Capcom, Square, Sega), else null."),
  completeness: enumOf(COMPLETENESS_IDS).describe("loose: cartridge or disc only. cib: box, game and (usually) manual. sealed: factory shrink-wrapped or with an intact seal. graded: in a WATA, VGA or CGC acrylic case."),
  grading: z.object({
    company: enumOf(COMPANY_IDS.filter((c) => c !== "none") as ["wata", "vga", "cgc"]).nullable().describe("If the game is in a grading company's case: wata, vga or cgc. Else null."),
    grade: z.string().nullable().describe("The grade on the label as printed, e.g. '9.4 A+' (WATA), '85' (VGA), '9.6' (CGC). Else null."),
    cert_number: z.string().nullable().describe("The certification number on the label, if legible."),
  }),
  box_condition: condition.describe("Condition of the box, when there is one: creases, crushed corners, tears, sun fading, price stickers. Null when no box is shown."),
  manual_condition: condition.describe("Condition of the manual, when shown. Null otherwise."),
  media_condition: condition.describe("Condition of the cartridge or disc: label wear, scratches, discolouration, writing. Null when it cannot be seen."),
  variant: z.string().nullable().describe("A printing or revision that changes value: 'Player's Choice', 'Greatest Hits', 'Not for Resale', 'Rev-A', a regional cover variant. Null for a standard release."),
  condition_notes: z.string().nullable().describe("Visible wear or damage in one or two sentences. Null if it looks clean or cannot be judged."),
  ...identificationBase,
});

export type GameIdentificationOutput = z.infer<typeof GameIdentification>;

export const SYSTEM_PROMPT = `You identify video games from photographs for a personal collection catalogue.

You will receive one or more photos of a single game: a cartridge or disc, a box front or back, a spine, a manual, or the label of a WATA, VGA or CGC grading case. Determine exactly which game it is: the title, the platform, the region, the year, the publisher, how complete the copy is, and any variant that affects value.

Guidance:
- Read the small print. Product codes (NES-XX-USA, SNSP-XXXX-EUR, SLUS-01234), rating logos (ESRB, PEGI, CERO), copyright lines and the shape of the cartridge are the most reliable clues to the platform and the region.
- Completeness matters more than anything else to a game's value. Say "sealed" only when shrink-wrap or a factory seal is actually visible; a clean box with no seal is "cib". A disc or cartridge on its own is "loose".
- If the game is in a grading company's case, read the label: the company, the grade exactly as printed (WATA grades read like "9.4 A+", VGA like "85", CGC like "9.6") and the certification number.
- Variants: a "Player's Choice" or "Greatest Hits" banner, a "Not for Resale" print, a revision code, a regional cover, a first print versus a later one. Report them; they are separate listings in every price guide.
- Judge condition only from what the photo shows, and separately for the box, the manual and the cartridge or disc. Be sceptical: glare hides scratches, a photo of the front cannot rule out damage to the back.
- If you cannot be sure, give your best single answer with an honest confidence and list the plausible alternatives (a Japanese release of the same game, a later revision, a similar title).`;

export const PROMPT = "Identify this video game and describe the copy shown.";

/** Turn what the model said into a record to save; anything it could not read is left for the form. */
export function toInput(id: Identification): ItemInput<Game> {
  const out = id as Partial<GameIdentificationOutput>;
  const pick = <T extends string>(value: unknown, ids: readonly T[]): T | undefined => (typeof value === "string" && (ids as readonly string[]).includes(value) ? (value as T) : undefined);
  const grading = out.grading ?? { company: null, grade: null, cert_number: null };
  const input: ItemInput<Game> = {
    title: typeof out.title === "string" ? out.title : "",
    platform: pick(out.platform, PLATFORM_IDS),
    region: pick(out.region, REGION_IDS),
    releaseYear: typeof out.release_year === "number" ? out.release_year : null,
    publisher: out.publisher ?? null,
    completeness: pick(out.completeness, COMPLETENESS_IDS) ?? "loose",
    gradingCompany: pick(grading.company, COMPANY_IDS) ?? "none",
    grade: grading.grade ?? null,
    certNumber: grading.cert_number ?? null,
    boxCondition: pick(out.box_condition, CONDITION_IDS) ?? null,
    manualCondition: pick(out.manual_condition, CONDITION_IDS) ?? null,
    mediaCondition: pick(out.media_condition, CONDITION_IDS) ?? null,
    variant: out.variant ?? null,
    notes: out.condition_notes ?? null,
  };
  // A slab label read as graded but with no company is still graded; the form asks which.
  if (input.completeness === "graded" && input.gradingCompany === "none") input.gradingCompany = undefined;
  return input;
}
