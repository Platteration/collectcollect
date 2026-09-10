import type { DomainSpec, ItemRecord } from "@collectcollect/core/domain/spec";
import { manualProvider, summarizeSimple, type SimpleExtras } from "@collectcollect/core/domain/pricing/index";
import { money } from "@collectcollect/core/format";
import { PROMPT, SYSTEM_PROMPT, WatchIdentification, toInput } from "./identify";
import { SEED } from "./seed";
import { BOX_PAPERS, CONDITIONS, DEFAULT_SETTINGS, MATERIALS, MOVEMENTS, cleanServiceHistory, type Watch, type WatchQuery, type WatchSettings } from "./types";

/**
 * Watches: every one is one specific object. Two of the same reference are
 * two rows, because a serial number, a service history and the marks on a
 * clasp belong to one watch and not to a model. Nothing here ever stacks.
 *
 * The serial number is private: it stays in the database and off the
 * Markdown copy, the CSV export and the report unless the owner opts in
 * (Settings for the files, the report's own switch for a printed copy).
 */
export const spec: DomainSpec<Watch, WatchSettings, SimpleExtras, WatchQuery> = {
  id: "watches",
  name: "Watches",
  description: "Track what your watches cost, what they are worth, when they were serviced, and print an appraisal an insurer will take.",
  noun: { singular: "watch", plural: "watches" },
  envPrefix: "WATCHES",
  titleField: "brand",
  fields: [
    { key: "brand", label: "Brand", type: "text", required: true, searchable: true, placeholder: "Omega", csvAliases: ["make", "manufacturer"] },
    { key: "model", label: "Model", type: "text", required: true, searchable: true, placeholder: "Speedmaster Professional", csvAliases: ["name", "line", "collection"] },
    { key: "referenceNumber", label: "Reference number", type: "text", searchable: true, placeholder: "310.30.42.50.01.001", csvAliases: ["reference", "ref", "ref no", "model number", "model no"] },
    { key: "serialNumber", label: "Serial number", type: "text", private: true, help: "Kept in the database only: left out of the Markdown copy, the CSV export and the report unless you opt in.", csvAliases: ["serial", "serial no", "case number"] },
    { key: "movement", label: "Movement", type: "enum", options: MOVEMENTS, filterable: true, aliases: { auto: "automatic", selfwinding: "automatic", automatique: "automatic", handwound: "manual", handwind: "manual", manualwind: "manual", mechanical: "manual", battery: "quartz", solar: "quartz", ecodrive: "quartz", springdrive: "automatic" }, csvAliases: ["movement type", "winding"] },
    { key: "caliber", label: "Calibre", type: "text", searchable: true, placeholder: "3861", csvAliases: ["calibre", "cal", "movement caliber"] },
    { key: "caseSize", label: "Case size, mm", type: "number", min: 10, max: 70, step: 0.1, csvAliases: ["case", "diameter", "size", "case diameter", "mm"] },
    { key: "caseMaterial", label: "Case material", type: "enum", options: MATERIALS, filterable: true, aliases: { stainless: "steel", stainlesssteel: "steel", ss: "steel", gold: "yellow_gold", yellowgold: "yellow_gold", yg: "yellow_gold", rosegold: "rose_gold", everose: "rose_gold", pinkgold: "rose_gold", rg: "rose_gold", whitegold: "white_gold", wg: "white_gold", pt: "platinum", ti: "titanium", plastic: "resin", twotone: "two_tone", steelandgold: "two_tone", rolesor: "two_tone" }, csvAliases: ["material", "case metal", "metal"] },
    { key: "dial", label: "Dial", type: "text", searchable: true, placeholder: "black, sunburst, date at 3", csvAliases: ["dial colour", "dial color", "face"] },
    { key: "braceletStrap", label: "Bracelet / strap", type: "text", placeholder: "Oyster bracelet", csvAliases: ["bracelet", "strap", "band"] },
    { key: "year", label: "Year", type: "integer", min: 1850, max: 2035, csvAliases: ["production year", "year of manufacture", "dob"] },
    { key: "boxPapers", label: "Box & papers", type: "enum", options: BOX_PAPERS, required: true, default: "neither", filterable: true, aliases: { full: "both", fullset: "both", boxandpapers: "both", boxpapers: "both", yes: "both", complete: "both", boxonly: "box", papersonly: "papers", cardonly: "papers", card: "papers", warrantycard: "papers", none: "neither", no: "neither", watchonly: "neither", headonly: "neither" }, csvAliases: ["box papers", "box and papers", "set", "accessories"] },
    { key: "condition", label: "Condition", type: "enum", options: CONDITIONS, required: true, default: "good", filterable: true, aliases: { unworn: "new", mint: "new", nos: "new", bnib: "new", lnib: "excellent", verygood: "excellent", vgc: "excellent", exc: "excellent", used: "good", worn: "good", poor: "fair", project: "fair" } },
    { key: "serviceHistory", label: "Service history", type: "json", hidden: true, help: "Date and what was done, kept on the watch's page.", csvAliases: ["service", "services", "service log", "serviced"], parse: cleanServiceHistory },
  ],
  title: (w) => `${w.brand} ${w.model}`.trim(),
  detail: (w) => [w.referenceNumber, w.caseSize ? `${w.caseSize} mm` : null, w.caseMaterial ? MATERIALS[w.caseMaterial] : null, w.year].filter(Boolean).join(" · "),
  conditionLabel: (w) => `${CONDITIONS[w.condition] ?? w.condition} · ${BOX_PAPERS[w.boxPapers] ?? w.boxPapers}`,
  // A watch is always one specific object, serial number or not.
  isUnique: () => true,
  identity: { keys: ["brand", "model", "referenceNumber"], uniqueKeys: ["serialNumber"] },
  normalize: (w) => {
    const clean = { ...w };
    clean.serviceHistory = cleanServiceHistory(clean.serviceHistory);
    if (clean.quantity > 1) clean.quantity = 1;
    return clean;
  },
  allocations: [
    { id: "brand", label: "Brand", keyOf: (w) => w.brand },
    { id: "caseMaterial", label: "Case material", keyOf: (w) => w.caseMaterial, labelOf: (k) => MATERIALS[k as keyof typeof MATERIALS] ?? k, unclassifiedNote: "no case material recorded" },
  ],
  pricing: {
    // TODO: a real source. Chrono24 has no public API and forbids scraping; WatchCharts sells API access
    // (https://watchcharts.com); auction results (Phillips, Christie's, Sotheby's, Loupe This) would need a per-house adapter.
    // A PriceProvider<WatchQuery> registered here is all any of them needs; the query already carries brand, model and reference.
    providers: [manualProvider("No market source is wired up yet. Type what each watch is worth, and enter past values with dates so the chart has a line to draw.")],
    query: (w) => ({ brand: w.brand, model: w.model, referenceNumber: w.referenceNumber }),
    summarize: ({ item, quotes, errors, fetchedAt }) => summarizeSimple({ item, quotes, errors, fetchedAt, priority: [] }),
    describe: (s) => (s.market === null ? "" : `${s.marketSource}: ${money(s.market)}`),
    manualNote: "The only source for now: what you say a watch is worth, and what it was worth on a date.",
  },
  settings: {
    defaults: DEFAULT_SETTINGS,
    fields: [
      { key: "insurer", label: "Insurer", type: "text", section: "Appraisal report", placeholder: "Hodinkee Insurance", help: "Printed under the report's title." },
      { key: "policyNumber", label: "Policy number", type: "text", section: "Appraisal report" },
    ],
  },
  identify: { schema: WatchIdentification, systemPrompt: SYSTEM_PROMPT, prompt: PROMPT, toInput },
  markdown: {
    index: [
      { header: "Reference", field: "referenceNumber" },
      { header: "Year", field: "year" },
    ],
    sections: (w) =>
      w.serviceHistory?.length
        ? [
            {
              heading: "Service history",
              body: ["| Date | What was done |", "| --- | --- |", ...w.serviceHistory.map((e) => `| ${e.date} | ${e.notes.replace(/\|/g, "\\|").replace(/\s+/g, " ")} |`)].join("\n"),
            },
          ]
        : [],
  },
  report: {
    title: "Watch collection appraisal",
    preamble: (s) => [s.insurer ? `Insured with ${s.insurer}` : null, s.policyNumber ? `policy ${s.policyNumber}` : null].filter(Boolean).join(", ") || null,
    columns: [
      { header: "Reference", value: (w) => w.referenceNumber ?? "" },
      { header: "Serial", value: (w) => w.serialNumber ?? "", private: true },
      { header: "Movement", value: (w) => [w.movement ? MOVEMENTS[w.movement] : null, w.caliber].filter(Boolean).join(" · ") },
      { header: "Case", value: (w) => [w.caseSize ? `${w.caseSize} mm` : null, w.caseMaterial ? MATERIALS[w.caseMaterial] : null].filter(Boolean).join(" ") },
      { header: "Year", value: (w) => (w.year ? String(w.year) : "") },
      { header: "Last serviced", value: (w) => w.serviceHistory?.at(-1)?.date ?? "" },
    ],
    note: "Values are what the owner recorded for each watch, with the date of the latest entry. Serial numbers and photos are included only when the report is printed with them switched on, for an insurer's schedule.",
  },
  seed: SEED,
  theme: { light: "#f3f8f7", dark: "#08110f" },
  emptyNote: "Photograph the dial and caseback and the form fills itself in, or type a watch in by hand. Enter what it is worth and when it was serviced; the chart, the report and the alerts follow from there.",
};

export type WatchRecord = ItemRecord<Watch>;
