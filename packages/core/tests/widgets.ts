import { z } from "zod";
import { createEngine } from "../src/domain/engine";
import { identificationBase } from "../src/domain/identify";
import { manualProvider, summarizeSimple, type SimpleExtras } from "../src/domain/pricing/index";
import type { DomainSpec, PriceProvider, PriceQuote } from "../src/domain/spec";

/**
 * A small made-up domain with one of every field type, so the engine is
 * tested against the shapes real apps use without depending on any of them.
 */
export interface Widget {
  name: string;
  maker: string | null;
  kind: "gizmo" | "gadget" | null;
  year: number | null;
  weight: number | null;
  signed: boolean;
  serial: string | null;
  boughtOn: string | null;
  tags: string[];
  history: Array<{ date: string; note: string }> | null;
}

export interface WidgetSettings {
  bonus: number;
  multipliers: Record<string, number>;
}

/** A fake source that answers by name. */
/** `answers` is read at call time, so a test can change what the source says between refreshes. */
export function fakeProvider(answers: Record<string, number>, id = "fake"): PriceProvider<{ name: string }> & { calls: number } {
  const provider = {
    id,
    label: `Fake ${id}`,
    optional: true,
    note: "test",
    calls: 0,
    isConfigured: () => true,
    async lookup(query: { name: string }): Promise<PriceQuote[]> {
      provider.calls++;
      const price = answers[query.name];
      if (price === undefined) return [];
      if (price < 0) throw new Error("source down");
      return [{ source: id, sourceLabel: `Fake ${id}`, currency: "USD", url: null, matchedName: query.name, matchedDetail: null, price, prices: {}, fetchedAt: new Date().toISOString() }];
    },
  };
  return provider;
}

export function widgetSpec(providers: PriceProvider<{ name: string }>[] = []): DomainSpec<Widget, WidgetSettings, SimpleExtras, { name: string }> {
  return {
    id: "testdomain",
    name: "Widgets",
    description: "Test widgets",
    noun: { singular: "widget", plural: "widgets" },
    envPrefix: "TESTDOMAIN",
    titleField: "name",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, searchable: true },
      { key: "maker", label: "Maker", type: "text", searchable: true, csvAliases: ["brand"] },
      { key: "kind", label: "Kind", type: "enum", options: { gizmo: "Gizmo", gadget: "Gadget" }, aliases: { thingy: "gizmo" }, filterable: true },
      { key: "year", label: "Year", type: "integer", min: 1800 },
      { key: "weight", label: "Weight", type: "number" },
      { key: "signed", label: "Signed", type: "boolean", filterable: true },
      { key: "serial", label: "Serial", type: "text", private: true },
      { key: "boughtOn", label: "Bought on", type: "date" },
      { key: "tags", label: "Tags", type: "list" },
      { key: "history", label: "History", type: "json" },
    ],
    title: (w) => w.name,
    detail: (w) => [w.maker, w.kind, w.year].filter(Boolean).join(" · "),
    conditionLabel: (w) => (w.signed ? "Signed" : "Unsigned"),
    isUnique: (w) => Boolean(w.serial),
    identity: { keys: ["name", "maker", "kind"], uniqueKeys: ["serial"] },
    pricing: {
      providers: [manualProvider("Type a price on the widget."), ...providers],
      query: (w) => ({ name: w.name }),
      summarize: ({ item, quotes, errors, fetchedAt }) => summarizeSimple({ item, quotes, errors, fetchedAt, priority: providers.map((p) => p.id) }),
      describe: (s) => (s.market === null ? "" : `${s.marketSource}: ${s.market}`),
    },
    settings: {
      defaults: { bonus: 5, multipliers: { a: 1.5 } },
      fields: [
        { key: "bonus", label: "Bonus", type: "number" },
        { key: "multipliers", label: "Multipliers", type: "numbers" },
      ],
    },
    identify: {
      schema: z.object({ name: z.string(), maker: z.string().nullable(), ...identificationBase }),
      systemPrompt: "Identify widgets.",
      prompt: "Identify this widget.",
      toInput: (id) => ({ name: String(id.name), maker: (id.maker as string | null) ?? null }),
    },
    markdown: {
      index: [{ header: "Maker", field: "maker" }],
      sections: (w) => (w.history?.length ? [{ heading: "History", body: w.history.map((h) => `- ${h.date}: ${h.note}`).join("\n") }] : []),
    },
    report: { columns: [{ header: "Maker", value: (w) => w.maker ?? "" }] },
    theme: { light: "#fff", dark: "#000" },
  };
}

export function widgetEngine(providers: PriceProvider<{ name: string }>[] = []) {
  const engine = createEngine(widgetSpec(providers));
  engine.db.setDb(engine.db.openDatabase(":memory:"));
  return engine;
}
