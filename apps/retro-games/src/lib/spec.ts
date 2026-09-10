import type { DomainSpec, ItemRecord } from "@collectcollect/core/domain/spec";
import { manualProvider } from "@collectcollect/core/domain/pricing/index";
import { GameIdentification, PROMPT, SYSTEM_PROMPT, toInput } from "./identify";
import { priceChartingProvider } from "./pricing/pricecharting";
import { describeGames, gradeWindowAlert, summarizeGames, type GameExtras } from "./pricing/summary";
import { SEED } from "./seed";
import { COMPANIES, COMPLETENESS, CONDITIONS, DEFAULT_SETTINGS, PLATFORMS, REGIONS, TIER_KEYS, type Game, type GameQuery, type GameSettings } from "./types";

const conditionOptions = { ...CONDITIONS };

/**
 * Retro games: cartridges and discs from the NES to the Wii U, loose or boxed
 * or sealed, some in WATA, VGA or CGC cases.
 *
 * One specific object or a stack: a graded copy is unique (its cert number
 * names it), and a loose, complete or sealed copy stacks with another that
 * is identical in every recorded respect, conditions included. "I own three
 * CIB copies of Sonic 2 in good shape" is one row with a quantity of three.
 */
export const spec: DomainSpec<Game, GameSettings, GameExtras, GameQuery> = {
  id: "retro-games",
  name: "Retro games",
  description: "Track what your retro games cost, what they are worth loose, boxed, sealed or graded, and whether it is time to grade one.",
  noun: { singular: "game", plural: "games" },
  envPrefix: "RETRO_GAMES",
  titleField: "title",
  fields: [
    { key: "title", label: "Title", type: "text", required: true, searchable: true, placeholder: "Super Mario 64", csvAliases: ["game", "name"] },
    { key: "platform", label: "Platform", type: "enum", options: PLATFORMS, required: true, searchable: true, filterable: true, aliases: { supernintendo: "snes", supernes: "snes", superfamicom: "snes", famicom: "nes", nintendo64: "n64", n64: "n64", gamecube: "gamecube", ngc: "gamecube", gb: "game_boy", gameboy: "game_boy", gbc: "game_boy_color", gameboycolor: "game_boy_color", gameboyadvance: "gba", megadrive: "genesis", segagenesis: "genesis", segamegadrive: "genesis", segasaturn: "saturn", segadreamcast: "dreamcast", playstation: "ps1", psx: "ps1", playstation2: "ps2", playstation3: "ps3", playstation4: "ps4", turbografx16: "tg16", pcengine: "tg16", neogeo: "neo_geo", nintendods: "ds", nintendo3ds: "3ds", xbox360: "xbox_360", xboxone: "xbox_one", atarijaguar: "jaguar" }, csvAliases: ["system", "console"] },
    { key: "region", label: "Region", type: "enum", options: REGIONS, required: true, default: "ntsc_u", filterable: true, aliases: { ntscu: "ntsc_u", ntsc: "ntsc_u", usa: "ntsc_u", us: "ntsc_u", na: "ntsc_u", northamerica: "ntsc_u", ntscj: "ntsc_j", jp: "ntsc_j", jpn: "ntsc_j", japan: "ntsc_j", japanese: "ntsc_j", eu: "pal", eur: "pal", europe: "pal", uk: "pal", aus: "pal", australia: "pal" } },
    { key: "releaseYear", label: "Release year", type: "integer", min: 1970, max: 2035, csvAliases: ["year", "released"] },
    { key: "publisher", label: "Publisher", type: "text", searchable: true, summary: true },
    {
      key: "completeness",
      label: "Completeness",
      type: "enum",
      options: COMPLETENESS,
      required: true,
      default: "loose",
      filterable: true,
      aliases: { complete: "cib", completeinbox: "cib", boxed: "cib", box: "cib", cartonly: "loose", cartridgeonly: "loose", disconly: "loose", cart: "loose", new: "sealed", factorysealed: "sealed", sealednew: "sealed", slabbed: "graded", slab: "graded", wata: "graded", vga: "graded" },
      csvAliases: ["condition type", "completeness", "complete"],
    },
    { key: "gradingCompany", label: "Grading company", type: "enum", options: COMPANIES, default: "none", section: "Grading", showWhen: { field: "completeness", equals: "graded" }, aliases: { cgcvideogames: "cgc", notgraded: "none", raw: "none" }, csvAliases: ["grader", "graded by", "company"] },
    { key: "grade", label: "Grade", type: "text", section: "Grading", placeholder: "9.4 A+", help: "As printed on the label: WATA 9.4 A+, VGA 85, CGC 9.6.", showWhen: { field: "completeness", equals: "graded" }, csvAliases: ["wata grade", "vga grade"] },
    { key: "certNumber", label: "Cert number", type: "text", section: "Grading", showWhen: { field: "completeness", equals: "graded" }, csvAliases: ["cert", "certification", "certificate", "serial"] },
    { key: "boxCondition", label: "Box condition", type: "enum", options: conditionOptions, section: "Condition", showWhen: { field: "completeness", in: ["cib", "sealed", "graded"] }, aliases: { nm: "near_mint", nearmint: "near_mint", vg: "very_good", verygood: "very_good", ex: "very_good", excellent: "very_good", g: "good", f: "fair", p: "poor", m: "mint" }, csvAliases: ["box"] },
    { key: "manualCondition", label: "Manual condition", type: "enum", options: conditionOptions, section: "Condition", showWhen: { field: "completeness", in: ["cib", "graded"] }, aliases: { nm: "near_mint", nearmint: "near_mint", vg: "very_good", verygood: "very_good", ex: "very_good", excellent: "very_good", g: "good", f: "fair", p: "poor", m: "mint" }, csvAliases: ["manual"] },
    { key: "mediaCondition", label: "Cart / disc condition", type: "enum", options: conditionOptions, section: "Condition", showWhen: { field: "completeness", in: ["loose", "cib", "graded"] }, aliases: { nm: "near_mint", nearmint: "near_mint", vg: "very_good", verygood: "very_good", ex: "very_good", excellent: "very_good", g: "good", f: "fair", p: "poor", m: "mint" }, csvAliases: ["cart condition", "disc condition", "cartridge condition", "media", "cart", "disc"] },
    { key: "variant", label: "Variant / revision", type: "text", searchable: true, summary: true, placeholder: "Player's Choice, Rev-A, Greatest Hits", csvAliases: ["revision", "printing", "edition"] },
  ],
  title: (g) => g.title,
  detail: (g) => [PLATFORMS[g.platform] ?? g.platform, REGIONS[g.region] ?? g.region, g.releaseYear].filter(Boolean).join(" · "),
  conditionLabel: (g) => {
    if (g.completeness === "graded") return [COMPANIES[g.gradingCompany] === "Not graded" ? "Graded" : COMPANIES[g.gradingCompany], g.grade].filter(Boolean).join(" ");
    return COMPLETENESS[g.completeness] ?? g.completeness;
  },
  isUnique: (g) => g.completeness === "graded",
  identity: {
    keys: ["title", "platform", "region", "completeness", "variant", "boxCondition", "manualCondition", "mediaCondition"],
    uniqueKeys: ["gradingCompany", "grade", "certNumber"],
  },
  normalize: (g) => {
    const clean = { ...g };
    if (clean.completeness === "graded") {
      if (!clean.grade) throw new Error("A graded game needs the grade printed on its label");
      if (clean.gradingCompany === "none") throw new Error("Say which company graded it");
    } else {
      // Grading fields only mean something in a case; a stray value would keep two identical loose copies apart.
      clean.gradingCompany = "none";
      clean.grade = null;
      clean.certNumber = null;
    }
    if (clean.completeness === "loose") {
      clean.boxCondition = null;
      clean.manualCondition = null;
    }
    if (clean.completeness === "sealed") {
      clean.manualCondition = null;
      clean.mediaCondition = null;
    }
    return clean;
  },
  allocations: [
    { id: "platform", label: "Platform", keyOf: (g) => g.platform, labelOf: (k) => PLATFORMS[k as keyof typeof PLATFORMS] ?? k },
    { id: "completeness", label: "Completeness", keyOf: (g) => g.completeness, labelOf: (k) => COMPLETENESS[k as keyof typeof COMPLETENESS] ?? k },
  ],
  pricing: {
    providers: [priceChartingProvider, manualProvider("A price typed on a game, under Loose, CIB, New or Graded, overrides PriceCharting for that key; past values can be entered by hand to draw the chart.")],
    query: (g) => ({ title: g.title, platform: g.platform, region: g.region, releaseYear: g.releaseYear, variant: g.variant, externalIds: g.externalIds }),
    summarize: summarizeGames,
    describe: describeGames,
    manualKeys: TIER_KEYS,
    concurrency: 2,
  },
  settings: {
    defaults: DEFAULT_SETTINGS,
    fields: [
      { key: "gradingFee", label: "Grading fee, all in", type: "number", section: "Grading", help: "What sending one game to WATA, VGA or CGC costs including shipping and insurance." },
      { key: "readyMinUpside", label: "Ready to grade needs at least this much upside", type: "number", section: "Grading" },
      { key: "readyMinUpsidePercent", label: "…and at least this much of the raw value, %", type: "number", section: "Grading" },
      { key: "gradeMultipliers", label: "Graded copy ≈ raw copy × (by the raw copy's completeness)", type: "numbers", section: "Grading", below: 100, help: "Used when PriceCharting has no graded price. New is a sealed copy." },
      { key: "conditionMultipliers", label: "Condition × (loose: the cart or disc; sealed: the box; complete: the worst part)", type: "numbers", section: "Condition", below: 10 },
    ],
  },
  alerts: {
    kinds: { grade_window: { label: "Grading window", icon: "◈" } },
    forRefresh: ({ item, history, next, settings }) => gradeWindowAlert({ item, history, next, settings }),
  },
  identify: { schema: GameIdentification, systemPrompt: SYSTEM_PROMPT, prompt: PROMPT, toInput },
  markdown: {
    index: [
      { header: "Platform", field: "platform" },
      { header: "Region", field: "region" },
    ],
  },
  report: {
    title: "Retro game collection valuation",
    columns: [
      { header: "Platform", value: (g) => PLATFORMS[g.platform] ?? g.platform },
      { header: "Region", value: (g) => REGIONS[g.region] ?? g.region },
      { header: "Year", value: (g) => (g.releaseYear ? String(g.releaseYear) : "") },
      { header: "Variant", value: (g) => g.variant ?? "" },
      { header: "Cert", value: (g) => g.certNumber ?? "" },
    ],
    note: "Values are PriceCharting's figures for the copy's completeness (loose, complete, sealed or graded), scaled by its recorded condition, or a price the owner entered by hand. Graded prices are PriceCharting's blended figure and do not distinguish grades.",
  },
  seed: SEED,
  theme: { light: "#f5f3ff", dark: "#0b0914" },
  emptyNote: "Photograph a cartridge, a box or a slab label and the form fills itself in, or type a game in by hand. PriceCharting prices it loose, complete, sealed and graded; the chart and the grade-or-wait verdict follow from there.",
};

export type GameRecord = ItemRecord<Game>;
