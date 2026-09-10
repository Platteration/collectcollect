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
  team: z.string().nullable().describe("For sports cards: the team printed on the card. Otherwise null."),
  rookie: z.boolean().describe("For sports cards: true when this is a rookie card (an RC logo, 'Rookie' printed on it, or a known first-year issue). Otherwise false."),
  parallel: z.string().nullable().describe("For sports cards: the parallel or refractor, with its colour and any ratio, e.g. 'Gold Refractor', 'Silver Prizm', 'Blue Wave 1:25'. Null for the base card."),
  serial_number: z.string().nullable().describe("Serial numbering as printed, e.g. '12/99'. Null when the card is not numbered."),
  autograph: z.boolean().describe("True when the card carries an on-card or sticker autograph."),
  relic: z.boolean().describe("True when the card carries a jersey, patch, bat or other memorabilia piece."),
  grading: z.object({
    company: z.string().nullable().describe("If the card is in a grading slab: PSA, BGS, CGC, SGC, TAG. Else null."),
    grade: z.string().nullable().describe("Grade printed on the slab label, e.g. '10', '9.5'. Else null."),
    cert_number: z.string().nullable().describe("Certification number printed on the slab label, if legible."),
    subgrades: z
      .object({
        centering: z.number().nullable(),
        corners: z.number().nullable(),
        edges: z.number().nullable(),
        surface: z.number().nullable(),
      })
      .nullable()
      .describe("The four subgrades on a BGS label (centering, corners, edges, surface), else null."),
  }),
  condition_notes: z
    .string()
    .nullable()
    .describe("Visible wear: whitening, scratches, creases, centering issues. Null if the card looks clean or condition is not assessable."),
  condition_assessment: z
    .object({
      centering: z.string().nullable().describe("Centering as seen, e.g. '60/40 left-right, 55/45 top-bottom', or a plain description. Null if not assessable from the photo."),
      corners: z.string().nullable().describe("Corner sharpness and any whitening or fraying. Null if not assessable."),
      edges: z.string().nullable().describe("Edge wear, chipping or whitening. Null if not assessable."),
      surface: z.string().nullable().describe("Surface: scratches, print lines, dents, gloss, creases. Null if not assessable."),
      estimated_grade_low: z
        .string()
        .nullable()
        .describe("Conservative end of the 10-point grade this raw card would likely receive, as a number like '7' or '8.5'. Null for a card already in a slab, or when the photo cannot support a guess."),
      estimated_grade_high: z
        .string()
        .nullable()
        .describe("Optimistic end of that range, e.g. '9'. Null under the same conditions as estimated_grade_low."),
      caveat: z
        .string()
        .nullable()
        .describe("Why the estimate could be wrong: glare, low resolution, only the front visible, sleeve or toploader in the way. Null if the photo is clear."),
    })
    .describe("Condition read from the photo. Every field may be null; only judge what is actually visible."),
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
