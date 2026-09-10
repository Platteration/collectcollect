import { z } from "zod";
import { identificationBase } from "@collectcollect/core/domain/identify";
import type { Identification, ItemInput } from "@collectcollect/core/domain/spec";
import { COMPANY_IDS, KEY_FLAG_IDS, PAGE_QUALITY_IDS, normalizeCoverDate, type Comic } from "./types";

const enumOf = <T extends string>(ids: T[]) => z.enum(ids as [T, ...T[]]);

/** What the vision model is asked to read off the photos, in the schema's own vocabulary. */
export const ComicIdentification = z.object({
  title: z.string().describe("The series title as printed on the cover, without the issue number: 'The Amazing Spider-Man', 'Saga'."),
  publisher: z.string().nullable().describe("Marvel, DC, Image, Dark Horse, IDW… from the logo or the indicia. Null if not visible."),
  issue_number: z.string().nullable().describe("The issue number as printed: '300', '1', 'Annual 1'. Null if not visible."),
  volume: z.number().int().nullable().describe("The volume number if the indicia or cover gives one (a 2016 'Vol. 4' relaunch), else null."),
  cover_date: z.string().nullable().describe("The cover date as 'YYYY-MM', or 'YYYY' if only the year can be read, else null."),
  variant: z.string().nullable().describe("A variant that changes value: 'Cover B', '1:25 incentive', '2nd printing', 'Newsstand', 'Direct edition', a facsimile. Null for a standard first-print direct edition."),
  key_issue_flags: z.array(enumOf(KEY_FLAG_IDS)).describe("Why the issue is a key, if it is one; empty when it is not or you do not know."),
  key_of: z.string().nullable().describe("Who or what the key flags are about: 'Venom', 'Wolverine', 'Miles Morales'. Null if none."),
  slabbed: z.boolean().describe("Whether the comic is in a CGC, CBCS or PGX case."),
  grading: z.object({
    company: enumOf(COMPANY_IDS.filter((c) => c !== "none") as ["cgc", "cbcs", "pgx"]).nullable().describe("The grading company on the label, if slabbed. Else null."),
    grade: z.string().nullable().describe("The grade on the label as printed, '9.8'. For a raw copy, your own estimate on the 10-point scale from what the photo shows, or null."),
    cert_number: z.string().nullable().describe("The certification number on the label, if legible."),
    page_quality: enumOf(PAGE_QUALITY_IDS).nullable().describe("Page quality from the label ('OFF-WHITE TO WHITE'), or null."),
    signature_series: z.boolean().describe("True for a yellow CGC Signature Series label, a CBCS Verified Signature, or a visible signature on the cover."),
  }),
  condition_notes: z.string().nullable().describe("Visible wear in a sentence or two: spine stress, colour breaks, corner wear, foxing, a subscription crease. Null if it looks clean or cannot be judged."),
  ...identificationBase,
});

export type ComicIdentificationOutput = z.infer<typeof ComicIdentification>;

export const SYSTEM_PROMPT = `You identify comic books from photographs for a personal collection catalogue.

You will receive one or more photos of a single comic: the cover, the indicia page, the back cover, or the label of a CGC, CBCS or PGX case. Determine exactly which issue it is: the series title, the publisher, the issue number, the volume if the series has been relaunched, the cover date, and any variant that affects value.

Guidance:
- Read the small print. The indicia (the fine print on the inside front cover or first page) gives the exact title, volume, issue number and cover date. The cover shows the issue number, the month and the price box; a UPC box with a barcode is a newsstand copy, a UPC box with art or a blank is a direct edition.
- Variants matter: a cover letter, an incentive ratio (1:25), a second printing, a newsstand copy, a facsimile edition. Report them; a facsimile of Amazing Spider-Man #300 is not the 1988 issue.
- Say why it is a key issue only when you are sure (first appearance of Venom, origin of Wolverine) and name who or what the key is about.
- If the comic is in a grading company's case, read the label: the company, the grade exactly as printed, the certification number, the page quality, and whether the label is a Signature Series (yellow) or Verified Signature label.
- Judge condition only from what the photo shows, and be sceptical: glare hides spine ticks and colour breaks, and the cover alone cannot rule out a loose centrefold or a missing coupon. For a raw copy give an honest single grade estimate, or none.
- If you cannot be sure, give your best single answer with an honest confidence and list the plausible alternatives (a reprint, a facsimile, a later printing, a different volume).`;

export const PROMPT = "Identify this comic book and describe the copy shown.";

/** Turn what the model said into a record to save; anything it could not read is left for the form. */
export function toInput(id: Identification): ItemInput<Comic> {
  const out = id as Partial<ComicIdentificationOutput>;
  const pick = <T extends string>(value: unknown, ids: readonly T[]): T | undefined => (typeof value === "string" && (ids as readonly string[]).includes(value) ? (value as T) : undefined);
  const grading = out.grading ?? { company: null, grade: null, cert_number: null, page_quality: null, signature_series: false };
  const slabbed = Boolean(out.slabbed) || Boolean(grading.company);
  const input: ItemInput<Comic> = {
    title: typeof out.title === "string" ? out.title : "",
    publisher: out.publisher ?? null,
    issueNumber: typeof out.issue_number === "string" ? out.issue_number : undefined,
    volume: typeof out.volume === "number" ? out.volume : null,
    coverDate: normalizeCoverDate(out.cover_date) ?? null,
    variant: out.variant ?? null,
    keyFlags: Array.isArray(out.key_issue_flags) ? out.key_issue_flags.filter((f): f is Comic["keyFlags"][number] => pick(f, KEY_FLAG_IDS) !== undefined) : [],
    keyOf: out.key_of ?? null,
    slabbed,
    gradingCompany: slabbed ? pick(grading.company, COMPANY_IDS) : "none",
    grade: grading.grade ?? null,
    certNumber: slabbed ? (grading.cert_number ?? null) : null,
    pageQuality: pick(grading.page_quality, PAGE_QUALITY_IDS) ?? null,
    signatureSeries: Boolean(grading.signature_series),
    notes: out.condition_notes ?? null,
  };
  return input;
}
