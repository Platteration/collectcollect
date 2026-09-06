import { z } from "zod";

export const IdentificationSchema = z.object({
  game: z.enum(["pokemon", "yugioh", "mtg", "sports", "other"]),
  sport: z
    .string()
    .nullable()
    .describe("For sports cards: baseball, basketball, football, hockey, soccer, etc. Otherwise null."),
  name: z
    .string()
    .describe("Card name as printed. For sports cards use the player's name."),
  set_name: z.string().nullable().describe("Set or product name, e.g. 'Base Set', 'Legend of Blue Eyes White Dragon', '2023 Topps Chrome'."),
  set_code: z.string().nullable().describe("Set code/abbreviation if printed, e.g. 'SV3', 'LOB', 'MH2'."),
  card_number: z
    .string()
    .nullable()
    .describe("Collector number as printed, e.g. '4/102', 'LOB-001', '150'. Include the denominator if shown."),
  year: z.number().int().nullable().describe("Year printed on the card (copyright year or season), else null."),
  rarity: z.string().nullable().describe("Rarity as printed or inferred, e.g. 'Holo Rare', 'Ultra Rare', 'Mythic', 'Refractor'."),
  variant: z
    .string()
    .nullable()
    .describe("Printing variant: 'holo', 'reverse holo', '1st edition', 'shadowless', 'foil', 'refractor', 'parallel', 'autograph', 'short print', etc."),
  language: z.string().nullable().describe("Language of the card text, e.g. 'English', 'Japanese'."),
  manufacturer: z.string().nullable().describe("Topps, Panini, Upper Deck, Bowman, Fleer, Konami, etc. Null if not applicable."),
  subject: z.string().nullable().describe("The character, player, or creature depicted if different from the card name."),
  grading: z.object({
    company: z.string().nullable().describe("If the card is in a grading slab: PSA, BGS, CGC, SGC, TAG. Else null."),
    grade: z.string().nullable().describe("Grade printed on the slab label, e.g. '10', '9.5'. Else null."),
    cert_number: z.string().nullable().describe("Certification number printed on the slab label, if legible."),
  }),
  condition_notes: z
    .string()
    .nullable()
    .describe("Visible wear: whitening, scratches, creases, centering issues. Null if the card looks clean or condition is not assessable."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How confident you are in the primary identification (name + set + number), 0 to 1."),
  alternatives: z
    .array(
      z.object({
        name: z.string(),
        set_name: z.string().nullable(),
        card_number: z.string().nullable(),
        reason: z.string(),
      }),
    )
    .describe("Other plausible identifications when uncertain (e.g. similar reprints). Empty when confident."),
  search_query: z
    .string()
    .describe("A concise query a price-guide search box would accept, e.g. 'Charizard 4/102 Base Set holo' or '2011 Topps Update Mike Trout US175'."),
});

export type IdentificationOutput = z.infer<typeof IdentificationSchema>;
