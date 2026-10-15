import type { DomainSpec, ItemRecord } from "@collectcollect/core/domain/spec";
import { manualProvider } from "@collectcollect/core/domain/pricing/index";
import { certVerifier } from "./cert";
import { ComicIdentification, PROMPT, SYSTEM_PROMPT, toInput } from "./identify";
import { priceChartingProvider } from "./pricing/pricecharting";
import { describeComics, gradeWindowAlert, summarizeComics, type ComicExtras } from "./pricing/summary";
import { SEED } from "./seed";
import { COMPANIES, DEFAULT_SETTINGS, KEY_FLAGS, PAGE_QUALITIES, coverYear, gradeNumber, normalizeCoverDate, type Comic, type ComicQuery, type ComicSettings } from "./types";

/**
 * Comics: single issues, raw or in a CGC, CBCS or PGX case.
 *
 * One specific object or a stack: a slabbed copy is unique (its cert number
 * names it), and a raw copy stacks with another that is the same issue, the
 * same variant and the same estimated grade. "I own three raw X-Men #1 in
 * 9.4" is one row with a quantity of three.
 */
export const spec: DomainSpec<Comic, ComicSettings, ComicExtras, ComicQuery> = {
  id: "comics",
  name: "Comics",
  description: "Track what your comics cost, what they are worth raw or slabbed at every grade, and whether a raw key is worth grading.",
  noun: { singular: "comic", plural: "comics" },
  envPrefix: "COMICS",
  titleField: "title",
  fields: [
    { key: "title", label: "Title / series", type: "text", required: true, searchable: true, placeholder: "The Amazing Spider-Man", csvAliases: ["series", "name", "comic"] },
    { key: "publisher", label: "Publisher", type: "text", searchable: true, placeholder: "Marvel", csvAliases: ["pub"] },
    { key: "issueNumber", label: "Issue", type: "text", required: true, searchable: true, placeholder: "300", csvAliases: ["issue", "number", "no", "#"] },
    { key: "volume", label: "Volume", type: "integer", min: 1, max: 99, csvAliases: ["vol"] },
    { key: "coverDate", label: "Cover date", type: "text", placeholder: "1988-05", help: "Year and month, or just the year.", csvAliases: ["date", "cover", "month", "year"] },
    { key: "variant", label: "Variant", type: "text", searchable: true, summary: true, placeholder: "Cover B, 2nd printing, Newsstand", csvAliases: ["cover letter", "printing", "edition"] },
    { key: "keyFlags", label: "Key issue", type: "list", options: KEY_FLAGS, section: "Key issue", aliases: { "1stapp": "first_appearance", "1stappearance": "first_appearance", firstapp: "first_appearance", "1st": "first_appearance", origins: "origin", dies: "death", "1stissue": "first_issue", lastissue: "last_issue", "1stcover": "first_cover", firstteam: "team_first", costume: "new_costume", movie: "adaptation", tv: "adaptation" }, csvAliases: ["key", "keys", "key issue", "key flags"] },
    { key: "keyOf", label: "Of whom / what", type: "text", searchable: true, section: "Key issue", placeholder: "Venom", csvAliases: ["key of", "character", "of"] },
    { key: "slabbed", label: "In a slab", type: "boolean", filterable: true, section: "Grading", default: false, csvAliases: ["graded", "slab", "encapsulated"] },
    { key: "gradingCompany", label: "Grading company", type: "enum", options: COMPANIES, default: "none", section: "Grading", filterable: true, showWhen: { field: "slabbed", truthy: true }, aliases: { notgraded: "none", raw: "none" }, csvAliases: ["grader", "company", "graded by"] },
    { key: "grade", label: "Grade", type: "text", section: "Grading", searchable: true, placeholder: "9.8", help: "The slab's grade, or your own estimate for a raw copy (9.2, 4.0).", csvAliases: ["cgc grade", "estimated grade", "condition"] },
    { key: "certNumber", label: "Cert number", type: "text", section: "Grading", showWhen: { field: "slabbed", truthy: true }, csvAliases: ["cert", "certification", "certificate", "serial"] },
    { key: "pageQuality", label: "Page quality", type: "enum", options: PAGE_QUALITIES, section: "Grading", aliases: { w: "white", oww: "off_white_to_white", owtow: "off_white_to_white", ow: "off_white", ctow: "cream_to_off_white", c: "cream", t: "tan", b: "brittle" }, csvAliases: ["pages", "pq"] },
    { key: "signatureSeries", label: "Signature series / witnessed signature", type: "boolean", section: "Grading", default: false, filterable: true, csvAliases: ["ss", "signed", "signature"] },
  ],
  title: (c) => `${c.title} #${c.issueNumber}`,
  detail: (c) => [c.publisher, c.volume ? `Vol. ${c.volume}` : null, c.coverDate, c.variant].filter(Boolean).join(" · "),
  conditionLabel: (c) => {
    if (c.slabbed) return [COMPANIES[c.gradingCompany] === "Not graded" ? "Slabbed" : COMPANIES[c.gradingCompany], c.grade, c.signatureSeries ? "SS" : null].filter(Boolean).join(" ");
    return c.grade ? `Raw ${c.grade}` : "Raw";
  },
  isUnique: (c) => c.slabbed,
  identity: {
    keys: ["title", "publisher", "issueNumber", "volume", "variant", "grade", "signatureSeries"],
    uniqueKeys: ["gradingCompany", "grade", "certNumber"],
  },
  normalize: (c) => {
    const clean = { ...c };
    if (clean.coverDate) {
      const date = normalizeCoverDate(clean.coverDate);
      if (!date) throw new Error("Cover date should be a year and month, like 1988-05 or May 1988");
      clean.coverDate = date;
    }
    if (clean.grade && gradeNumber(clean.grade) === null) throw new Error("Grade should carry a number on the 10-point scale, like 9.8 or VF/NM 9.0");
    if (clean.slabbed) {
      if (clean.gradingCompany === "none") throw new Error("Say which company graded it");
      if (!clean.grade) throw new Error("A slabbed comic needs the grade on its label");
    } else {
      // A raw copy has no company and no cert; a stray value would keep two identical raw copies apart.
      clean.gradingCompany = "none";
      clean.certNumber = null;
    }
    return clean;
  },
  allocations: [
    { id: "publisher", label: "Publisher", keyOf: (c) => c.publisher, unclassifiedNote: "no publisher recorded" },
    { id: "slabbed", label: "Format", keyOf: (c) => (c.slabbed ? "slabbed" : "raw"), labelOf: (k) => (k === "slabbed" ? "Slabbed" : "Raw") },
  ],
  pricing: {
    // TODO: an eBay sold-listings aggregation by grade would cover what PriceCharting does not.
    providers: [priceChartingProvider, manualProvider("A price typed on a comic overrides every source; one typed under a grade key (Grade 9.8) overrides PriceCharting for that grade. Past values can be entered by hand to draw the chart.")],
    query: (c) => ({ title: c.title, publisher: c.publisher, issueNumber: c.issueNumber, volume: c.volume, coverYear: coverYear(c.coverDate), variant: c.variant, externalIds: c.externalIds }),
    summarize: summarizeComics,
    describe: describeComics,
    manualKeys: ["Ungraded", "Grade 9.8", "Grade 9.6", "Grade 9.4", "Grade 9.2", "Grade 9.0", "Grade 8.0", "Grade 6.0", "Grade 4.0"],
    concurrency: 2,
  },
  settings: {
    defaults: DEFAULT_SETTINGS,
    fields: [
      { key: "gradingFee", label: "Grading fee, all in", type: "number", section: "Grading", help: "What sending one book to CGC or CBCS costs including shipping and insurance." },
      { key: "readyMinUpside", label: "Ready to grade needs at least this much upside", type: "number", section: "Grading" },
      { key: "readyMinUpsidePercent", label: "…and at least this much of the raw value, %", type: "number", section: "Grading" },
      { key: "gradeMultipliers", label: "Slabbed copy ≈ raw price × (by grade)", type: "numbers", section: "Grading", below: 100, editableKeys: true, help: "Used for a grade PriceCharting has no sale at." },
      { key: "rawGradeMultipliers", label: "Raw copy ≈ raw price × (by the estimated grade, lowest bucket at or below it)", type: "numbers", section: "Grading", below: 10 },
      { key: "signatureSeriesMultiplier", label: "Witnessed signature ×", type: "number", section: "Grading", below: 10 },
    ],
  },
  alerts: {
    kinds: { grade_window: { label: "Grading window", icon: "◈" } },
    forRefresh: ({ item, history, next, settings }) => gradeWindowAlert({ item, history, next, settings }),
  },
  identify: { schema: ComicIdentification, systemPrompt: SYSTEM_PROMPT, prompt: PROMPT, toInput },
  markdown: {
    index: [
      { header: "Publisher", field: "publisher" },
      { header: "Key", field: "keyFlags" },
    ],
    sections: (c) => (c.keyFlags.length || c.keyOf ? [{ heading: "Key issue", body: [c.keyFlags.map((f) => KEY_FLAGS[f]).join(", "), c.keyOf].filter(Boolean).join(" — ") || "" }] : []),
  },
  report: {
    title: "Comic collection valuation",
    columns: [
      { header: "Publisher", value: (c) => c.publisher ?? "" },
      { header: "Cover date", value: (c) => c.coverDate ?? "" },
      { header: "Key", value: (c) => [c.keyFlags.map((f) => KEY_FLAGS[f]).join(", "), c.keyOf].filter(Boolean).join(": ") },
      { header: "Pages", value: (c) => (c.pageQuality ? PAGE_QUALITIES[c.pageQuality] : "") },
      { header: "Cert", value: (c) => c.certNumber ?? "" },
    ],
    note: "Values are PriceCharting's figures at the copy's grade (a raw copy at the raw price, scaled for its estimated grade), or a price the owner entered by hand. A witnessed signature is applied as a multiplier from Settings.",
  },
  cert: certVerifier,
  seed: SEED,
  theme: { light: "#fff8f6", dark: "#130909" },
  emptyNote: "Photograph a cover or a slab label and the form fills itself in, or type an issue in by hand. PriceCharting prices it raw and at every grade; the chart and the grade-or-wait verdict follow from there.",
};

export type ComicRecord = ItemRecord<Comic>;
