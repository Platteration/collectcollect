import { z } from "zod";
import { identificationBase } from "@collectcollect/core/domain/identify";
import { manualProvider, summarizeSimple, type SimpleExtras } from "@collectcollect/core/domain/pricing/index";
import type { DomainSpec, Identification } from "@collectcollect/core/domain/spec";

/**
 * What a __SINGULAR__ is, as far as this app is concerned. Everything the app
 * does — the database, the forms, search and filters, the Markdown mirror,
 * CSV import and export, the report — follows from this description.
 */
export interface __TYPE__ {
  name: string;
  maker: string | null;
  signed: boolean;
  serial: string | null;
}

export type __TYPE__Settings = Record<string, never>;

export interface Query {
  name: string;
  maker: string | null;
}

export const spec: DomainSpec<__TYPE__, __TYPE__Settings, SimpleExtras, Query> = {
  id: "__ID__",
  name: "__NAME__",
  description: "Track what your __PLURAL__ cost and what they are worth.",
  noun: { singular: "__SINGULAR__", plural: "__PLURAL__" },
  envPrefix: "__PREFIX__",
  titleField: "name",
  fields: [
    { key: "name", label: "Name", type: "text", required: true, searchable: true },
    { key: "maker", label: "Maker", type: "text", searchable: true, summary: true },
    { key: "signed", label: "Signed", type: "boolean", filterable: true, default: false },
    { key: "serial", label: "Serial number", type: "text", private: true, help: "Kept out of the Markdown copy and exports unless you opt in under Settings." },
  ],
  title: (item) => item.name,
  detail: (item) => item.maker ?? "",
  conditionLabel: (item) => (item.signed ? "Signed" : "Unsigned"),
  // A signed copy is one specific object; unsigned identical copies stack.
  // (Do not key uniqueness on a private field: it is left out of the Markdown
  // copy by default, and the mirror's index reads the files.)
  isUnique: (item) => item.signed,
  identity: { keys: ["name", "maker"], uniqueKeys: ["serial"] },
  pricing: {
    // TODO: replace the manual-entry source with a real one for __PLURAL__.
    providers: [manualProvider("No price source is wired up yet. Type a value on each __SINGULAR__, or enter past values to draw the chart.")],
    query: (item) => ({ name: item.name, maker: item.maker }),
    summarize: ({ item, quotes, errors, fetchedAt }) => summarizeSimple({ item, quotes, errors, fetchedAt, priority: [] }),
  },
  settings: { defaults: {}, fields: [] },
  identify: {
    schema: z.object({
      name: z.string().describe("What the __SINGULAR__ is called."),
      maker: z.string().nullable().describe("Who made it, if it can be read from the photo."),
      signed: z.boolean().describe("Whether a signature is visible."),
      ...identificationBase,
    }),
    systemPrompt: "You identify __PLURAL__ from photographs. Read only what the photos show; leave unknown fields null and say how sure you are.",
    prompt: "Identify this __SINGULAR__.",
    toInput: (id: Identification) => ({ name: String(id.name ?? ""), maker: (id.maker as string | null) ?? null, signed: Boolean(id.signed) }),
  },
  report: { columns: [{ header: "Maker", value: (item) => item.maker ?? "" }] },
  theme: { light: "__BG_LIGHT__", dark: "__BG_DARK__" },
  emptyNote: "Add a __SINGULAR__ by photographing it or filling in the form, or import a spreadsheet. Prices, the chart and the report follow from there.",
};
