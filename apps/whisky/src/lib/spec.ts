import type { DomainSpec, ItemRecord } from "@collectcollect/core/domain/spec";
import { defaultValueOf, manualProvider, summarizeSimple, type SimpleExtras } from "@collectcollect/core/domain/pricing/index";
import { money } from "@collectcollect/core/format";
import { BottleIdentification, PROMPT, SYSTEM_PROMPT, toInput } from "./identify";
import { onUpdate } from "./open";
import { SEED } from "./seed";
import { PACKAGING, REGIONS, isBottleNumber, type Bottle, type BottleQuery, type BottleSettings } from "./types";

/**
 * Whisky: bottles, sealed or open.
 *
 * One specific object or a stack: sealed bottles stack when they are the
 * same bottling in every recorded respect ("I own three of these"), except
 * that a numbered bottle ("Bottle 123 of 2000") is one object. Once a
 * bottle is opened it is one specific object at its own fill level, its
 * investment value is frozen at what it was worth that day, and it leaves
 * the portfolio total while staying in the collection.
 */
export const spec: DomainSpec<Bottle, BottleSettings, SimpleExtras, BottleQuery> = {
  id: "whisky",
  name: "Whisky",
  description: "Track what your bottles cost and what the sealed ones are worth, and keep the open ones for drinking without losing what they were.",
  noun: { singular: "bottle", plural: "bottles" },
  envPrefix: "WHISKY",
  titleField: "distillery",
  fields: [
    { key: "distillery", label: "Distillery / brand", type: "text", required: true, searchable: true, placeholder: "Ardbeg", csvAliases: ["distillery", "brand", "producer", "maker"] },
    { key: "expression", label: "Expression", type: "text", required: true, searchable: true, placeholder: "Uigeadail", csvAliases: ["name", "bottling", "release", "whisky"] },
    { key: "ageStatement", label: "Age statement, years", type: "integer", min: 1, max: 100, help: "Leave empty for a no-age-statement bottling.", csvAliases: ["age", "years", "yo"] },
    { key: "vintage", label: "Vintage", type: "integer", min: 1900, max: 2035, help: "Distillation year.", csvAliases: ["distilled", "distillation year"] },
    { key: "bottlingYear", label: "Bottling year", type: "integer", min: 1900, max: 2035, csvAliases: ["bottled", "year"] },
    { key: "caskType", label: "Cask type", type: "text", searchable: true, placeholder: "oloroso sherry finish", csvAliases: ["cask", "wood", "finish"] },
    { key: "abv", label: "ABV, %", type: "number", min: 20, max: 80, step: 0.1, csvAliases: ["strength", "alcohol", "proof"] },
    { key: "bottleSize", label: "Bottle size, ml", type: "integer", required: true, default: 700, min: 50, max: 4500, csvAliases: ["size", "volume", "ml", "cl"] },
    { key: "bottleNumber", label: "Bottle / batch number", type: "text", placeholder: "Bottle 123 of 2000, or Batch 12", help: "A bottle number names one bottle; a batch is shared by a run.", csvAliases: ["bottle no", "batch", "batch number", "lot"] },
    { key: "region", label: "Region / country", type: "enum", options: REGIONS, filterable: true, aliases: { scotland: "scotland_blend", scotch: "scotland_blend", blend: "scotland_blend", blended: "scotland_blend", skye: "islands", orkney: "islands", jura: "islands", arran: "islands", mull: "islands", irish: "ireland", american: "usa", kentucky: "usa", tennessee: "usa", bourbon: "usa", japanese: "japan", us: "usa", uk: "scotland_blend" }, csvAliases: ["country", "region", "origin"] },
    { key: "packaging", label: "Packaging", type: "enum", options: PACKAGING, required: true, default: "none", filterable: true, aliases: { tin: "tube", canister: "tube", carton: "box", presentation: "box", case: "box", boxed: "box", no: "none", bare: "none", bottleonly: "none" } },
    { key: "sealed", label: "Sealed", type: "boolean", default: true, filterable: true, help: "Untick to open the bottle: its value is frozen at today's and it leaves the portfolio total.", csvAliases: ["unopened", "closed", "intact"] },
    { key: "fillLevel", label: "Fill level, %", type: "integer", min: 0, max: 100, showWhen: { field: "sealed", falsy: true }, csvAliases: ["fill", "level", "remaining"] },
    // A day, not an instant: kept as text so "2025-12-25" reads back as itself.
    { key: "openedAt", label: "Opened on", type: "text", hidden: true, csvAliases: ["opened", "opened on", "date opened"] },
    { key: "frozenValue", label: "Value when opened", type: "number", hidden: true, min: 0, csvAliases: ["value when opened", "frozen value"] },
  ],
  title: (b) => `${b.distillery} ${b.expression}`.trim(),
  detail: (b) =>
    [b.ageStatement ? `${b.ageStatement} yo` : null, b.vintage ? `${b.vintage} vintage` : null, b.abv ? `${b.abv}%` : null, b.bottleSize !== 700 ? `${b.bottleSize} ml` : null, b.region ? REGIONS[b.region] : null]
      .filter(Boolean)
      .join(" · "),
  conditionLabel: (b) => (b.sealed ? `Sealed${b.packaging !== "none" ? ` · ${PACKAGING[b.packaging]}` : ""}` : `Open · ${b.fillLevel ?? "?"}% left`),
  isUnique: (b) => !b.sealed || isBottleNumber(b.bottleNumber),
  identity: {
    keys: ["distillery", "expression", "ageStatement", "vintage", "bottlingYear", "caskType", "abv", "bottleSize", "bottleNumber", "packaging"],
    uniqueKeys: ["bottleNumber", "openedAt"],
  },
  normalize: (b) => {
    const clean = { ...b };
    if (clean.openedAt) {
      const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(clean.openedAt) ? `${clean.openedAt}T12:00:00` : clean.openedAt);
      if (Number.isNaN(parsed.getTime())) throw new Error("Opened on should be a date, like 2025-12-25");
      clean.openedAt = parsed.toISOString().slice(0, 10);
    }
    if (clean.sealed) {
      clean.fillLevel = null;
    } else {
      if (clean.fillLevel === null) clean.fillLevel = 100;
      if (clean.openedAt === null) clean.openedAt = new Date().toISOString().slice(0, 10);
      // One open bottle is one bottle; the sealed copies stay in their own row.
      clean.quantity = Math.min(clean.quantity, 1);
    }
    return clean;
  },
  hooks: { beforeUpdate: onUpdate },
  excludeFromPortfolio: (b) => !b.sealed,
  excludedNote: "open bottles are for drinking and are not counted; each keeps the value it had the day it was opened",
  valuation: (b, snapshot) => {
    if (!b.sealed) {
      if (b.frozenValue !== null) return { value: b.frozenValue, basis: `Frozen when opened${b.openedAt ? ` on ${b.openedAt}` : ""}` };
      return { value: null, basis: "Opened before it was ever valued" };
    }
    return defaultValueOf(b, snapshot);
  },
  allocations: [
    { id: "region", label: "Region", keyOf: (b) => b.region, labelOf: (k) => REGIONS[k as keyof typeof REGIONS] ?? k, unclassifiedNote: "no region recorded" },
    { id: "distillery", label: "Distillery", keyOf: (b) => b.distillery },
  ],
  pricing: {
    // TODO: an auction-house source. Whisky Auctioneer, Scotch Whisky Auctions and Whisky Hammer publish
    // hammer prices per lot but no API; WhiskyBase has a market page. Any of them is a PriceProvider<BottleQuery>
    // registered here; the query carries distillery, expression, age, vintage, bottling year and size.
    providers: [manualProvider("No auction source is wired up yet. Type what a sealed bottle is worth, and enter past hammer prices with dates so the chart has a line to draw.")],
    query: (b) => ({ distillery: b.distillery, expression: b.expression, ageStatement: b.ageStatement, vintage: b.vintage, bottlingYear: b.bottlingYear, bottleSize: b.bottleSize }),
    summarize: ({ item, quotes, errors, fetchedAt }) => summarizeSimple({ item, quotes, errors, fetchedAt, priority: [] }),
    describe: (s) => (s.market === null ? "" : `${s.marketSource}: ${money(s.market)}`),
    manualNote: "The only source for now: what you say a bottle is worth, and what it fetched on a date.",
  },
  settings: { defaults: {}, fields: [] },
  identify: { schema: BottleIdentification, systemPrompt: SYSTEM_PROMPT, prompt: PROMPT, toInput },
  markdown: {
    index: [
      { header: "Region", field: "region" },
      { header: "Age", field: "ageStatement" },
    ],
    sections: (b) => (!b.sealed ? [{ heading: "Opened", body: `Opened${b.openedAt ? ` on ${b.openedAt}` : ""}, ${b.fillLevel ?? "?"}% left. ${b.frozenValue !== null ? `Value frozen at ${money(b.frozenValue)}; not counted in the portfolio.` : "Not valued before it was opened."}` }] : []),
  },
  report: {
    title: "Whisky collection valuation",
    columns: [
      { header: "Region", value: (b) => (b.region ? REGIONS[b.region] : "") },
      { header: "Age", value: (b) => (b.ageStatement ? `${b.ageStatement} yo` : b.vintage ? `${b.vintage}` : "NAS") },
      { header: "ABV", value: (b) => (b.abv ? `${b.abv}%` : "") },
      { header: "Size", value: (b) => `${b.bottleSize} ml` },
      { header: "Bottle / batch", value: (b) => b.bottleNumber ?? "" },
      { header: "Fill", value: (b) => (b.sealed ? "sealed" : `${b.fillLevel ?? "?"}%`) },
    ],
    note: "Sealed bottles are valued at what the owner last recorded for them. Open bottles are listed at the value they had the day they were opened and are not counted in the total.",
  },
  seed: SEED,
  theme: { light: "#fdf8f1", dark: "#120c06" },
  emptyNote: "Photograph a label and the form fills itself in, or type a bottle in by hand. Enter what the sealed ones are worth; open one and it keeps that value while it is drunk.",
};

export type BottleRecord = ItemRecord<Bottle>;
