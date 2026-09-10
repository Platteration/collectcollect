import type { ZodType } from "zod";

/**
 * What an app has to say about its collectible for the engine to run it.
 *
 * Everything the engine does — the database schema, validation, search and
 * filters, intake merging, the Markdown mirror, CSV import and export, the
 * report, the forms — is driven by this description. An app is a spec plus
 * its price providers, its identification prompt, its seed data and whatever
 * pages it wants beyond the standard ones.
 */

export type FieldType = "text" | "number" | "integer" | "boolean" | "enum" | "date" | "json" | "list";

export interface FieldCondition {
  field: string;
  equals?: string | boolean;
  in?: string[];
  truthy?: boolean;
  falsy?: boolean;
}

export interface FieldSpec {
  /** camelCase key on the record, e.g. "releaseYear". */
  key: string;
  label: string;
  type: FieldType;
  /** enum: id -> label, in display order. On a list, the choices of a multi-select. */
  options?: Record<string, string>;
  /** enum: other spellings accepted on import, keyed by `headerKey` form, e.g. { ntscu: "ntsc_u" }. */
  aliases?: Record<string, string>;
  required?: boolean;
  /** Part of the free-text search on the collection page. */
  searchable?: boolean;
  /** Offered as a filter on the collection page (enum or boolean fields). */
  filterable?: boolean;
  /** Kept out of the Markdown mirror, the CSV export and the report unless the owner opts in. */
  private?: boolean;
  /** Extra CSV header spellings, matched after `headerKey` normalisation. */
  csvAliases?: string[];
  help?: string;
  placeholder?: string;
  multiline?: boolean;
  /** Only shown in the form when the condition holds. */
  showWhen?: FieldCondition;
  /** Heading the form groups this field under. */
  section?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Used when nothing is given. */
  default?: unknown;
  /** Takes a full row in the form. */
  wide?: boolean;
  /** Kept out of the generic form: the app edits it with its own UI (a service log, a list of entries). */
  hidden?: boolean;
  /** How a spreadsheet cell reads for this field, when the type's own reading is not enough (a service log written as prose). May throw. */
  parse?(text: string): unknown;
  /** Shown on tiles and the report as an extra line. */
  summary?: boolean;
}

/** What the vision model reports. Domain fields sit beside these two. */
export interface Identification {
  confidence: number;
  alternatives: Array<{ label: string; reason: string } & Record<string, unknown>>;
  [key: string]: unknown;
}

export interface BaseItem {
  id: number;
  quantity: number;
  /** Average of what the copies still held cost; derived from the lots. */
  purchasePrice: number | null;
  notes: string | null;
  /** Where the thing is physically kept. */
  location: string | null;
  /** Upload names, first is the primary photo. */
  photos: string[];
  referenceImageUrl: string | null;
  /** Average colour of the primary photo (#rrggbb), used to tint the page. */
  accentColor: string | null;
  externalIds: Record<string, string>;
  identification: Identification | null;
  /** A value typed in by hand, which overrides every source. */
  manualValue: number | null;
  /** Prices typed in by hand under named keys (a grade, a completeness), for domains that price by key. */
  manualPrices: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export const BASE_ITEM_KEYS: Array<keyof BaseItem> = [
  "id",
  "quantity",
  "purchasePrice",
  "notes",
  "location",
  "photos",
  "referenceImageUrl",
  "accentColor",
  "externalIds",
  "identification",
  "manualValue",
  "manualPrices",
  "createdAt",
  "updatedAt",
];

export type ItemRecord<F extends object = Record<string, unknown>> = BaseItem & F;

/** Fields a client may send when creating or updating. */
export type ItemInput<F extends object = Record<string, unknown>> = Partial<Omit<BaseItem, "id" | "createdAt" | "updatedAt">> & Partial<F>;

/** What normalisation produces: every base field and every domain field present. */
export type NormalizedItem<F extends object = Record<string, unknown>> = Omit<BaseItem, "id" | "createdAt" | "updatedAt"> & F;

export type Currency = "USD" | "EUR";

/** One source's answer for one item. */
export interface PriceQuote {
  source: string;
  sourceLabel: string;
  currency: Currency;
  url: string | null;
  matchedName: string;
  matchedDetail: string | null;
  /** The headline number this source gives, e.g. the ungraded or lowest-ask price. */
  price: number | null;
  /** Named prices the source publishes beside it: grades, completeness, printings. */
  prices: Record<string, number>;
  fetchedAt: string;
  externalId?: string;
  referenceImageUrl?: string | null;
}

export interface PriceError {
  source: string;
  message: string;
}

export interface PriceSummaryBase {
  currency: "USD";
  fetchedAt: string;
  /** What the owner's copy is worth, and how that was decided. */
  yourCopyValue: number | null;
  yourCopyBasis: string;
  quotes: PriceQuote[];
  errors: PriceError[];
}

/** The consolidated view stored per refresh. Domains add their own fields. */
export type PriceSummary<X extends object = Record<string, unknown>> = PriceSummaryBase & X;

export interface PriceSnapshot<X extends object = Record<string, unknown>> {
  id: number;
  itemId: number;
  fetchedAt: string;
  summary: PriceSummary<X>;
}

export interface PriceProvider<Q = unknown> {
  id: string;
  label: string;
  optional: boolean;
  note: string;
  isConfigured(): boolean;
  /** Load a whole catalogue before a run of lookups; optional and always safe to skip. */
  prime?(fetchImpl?: typeof fetch): Promise<void>;
  lookup(query: Q, fetchImpl?: typeof fetch): Promise<PriceQuote[]>;
}

export class ProviderError extends Error {
  constructor(
    public readonly source: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  optional: boolean;
  note: string;
}

export interface Valuation {
  value: number | null;
  basis: string;
}

export interface BaseSettings {
  /** Shown on the printable appraisal report. */
  ownerName: string;
  /** Raise a price-move alert when a copy's value changes by at least this much between refreshes. */
  alertMovePercent: number;
  /** Optional URL that new alerts are POSTed to. */
  alertWebhookUrl: string;
  /** Whether private fields (a serial number) are written to the mirror and the exports. */
  exportPrivateFields: boolean;
}

export const BASE_SETTINGS: BaseSettings = {
  ownerName: "",
  alertMovePercent: 15,
  alertWebhookUrl: "",
  exportPrivateFields: false,
};

export type Settings<S extends object = Record<string, unknown>> = BaseSettings & S;

export type SettingFieldType = "number" | "text" | "url" | "boolean" | "numbers";

export interface SettingFieldSpec {
  key: string;
  label: string;
  type: SettingFieldType;
  help?: string;
  section?: string;
  /** numbers: a non-negative number strictly below this. */
  below?: number;
  placeholder?: string;
  /** numbers: the keys may be added and removed by the owner (a grade list). */
  editableKeys?: boolean;
}

export interface Alert {
  id: number;
  kind: string;
  itemId: number | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface NewAlert {
  kind: string;
  itemId: number | null;
  title: string;
  body: string;
}

export interface Sale {
  id: number;
  itemId: number;
  quantity: number;
  unitPrice: number;
  fees: number;
  unitCost: number | null;
  soldAt: string;
  venue: string | null;
  notes: string | null;
  createdAt: string;
}

export interface SaleWithItem extends Sale {
  itemName: string;
  itemDetail: string;
}

export interface CertVerification {
  status: "match" | "mismatch" | "unknown";
  detail: string;
}

/** Checks a grading company's certificate number against its register. */
export interface CertVerifier<F extends object = Record<string, unknown>> {
  label: string;
  note: string;
  /** Whether this item carries something to check; default: always. */
  applies?(item: ItemRecord<F>): boolean;
  verify(item: ItemRecord<F>, fetchImpl?: typeof fetch): Promise<CertVerification>;
}

export interface AllocationSpec<F extends object> {
  id: string;
  label: string;
  keyOf(item: ItemRecord<F>): string | null;
  /** How a key reads on screen; default: the key itself. */
  labelOf?(key: string): string;
  color?(key: string): string | null;
  /** What to call value the grouping has no answer for. */
  unclassifiedNote?: string;
}

export interface SeedLot {
  quantity?: number;
  unitCost?: number | null;
  acquiredAt?: string;
  source?: string | null;
  notes?: string | null;
}

/** One realistic example loaded into an empty collection so the pages have something to show. */
export interface SeedItem<F extends object> {
  input: ItemInput<F>;
  /** The purchase behind it; default: the input's quantity at its purchase price, dated today. */
  lot?: SeedLot;
  /** Past values, oldest first, so the chart has a line; the last one is the current value. */
  history?: Array<{ value: number; at: string; note?: string }>;
}

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export interface SummarizeArgs<F extends object, S extends object> {
  item: ItemRecord<F>;
  quotes: PriceQuote[];
  errors: PriceError[];
  settings: Settings<S>;
  fetchedAt: string;
}

export interface HookContext<X extends object> {
  /** The item's most recent stored price, if any. */
  latestSnapshot(): PriceSnapshot<X> | null;
}

export interface RefreshAlertArgs<F extends object, S extends object, X extends object> {
  item: ItemRecord<F>;
  previous: PriceSummary<X> | null;
  next: PriceSummary<X>;
  /** Stored history, oldest first, not including `next`. */
  history: PriceSnapshot<X>[];
  settings: Settings<S>;
}

export interface DomainSpec<
  F extends object = Record<string, unknown>,
  S extends object = Record<string, unknown>,
  X extends object = Record<string, unknown>,
  Q = unknown,
> {
  /** Slug used for the database file, the cookie and the global namespace, e.g. "retro-games". */
  id: string;
  /** Name shown in the header and the page title, e.g. "Retro games". */
  name: string;
  description: string;
  noun: { singular: string; plural: string };
  /** Prefix for this app's environment variables: <PREFIX>_DATA_DIR, <PREFIX>_APP_PASSWORD, ... */
  envPrefix: string;
  /** Markdown subfolder holding one file per item; defaults to the plural noun. */
  folder?: string;
  fields: FieldSpec[];
  /** The field that names an item; it is required, searchable and heads every table. */
  titleField: string;
  title(item: ItemRecord<F>): string;
  /** One line of what it is, e.g. "N64 · NTSC-U · 1996". */
  detail(item: ItemRecord<F>): string;
  /** The condition or grade phrase, e.g. "WATA 9.4 A+" or "Sealed". */
  conditionLabel(item: ItemRecord<F>): string;
  /** Whether a row is one specific object (never merged, quantity 1) rather than a fungible stack. */
  isUnique(item: NormalizedItem<F> | ItemRecord<F>): boolean;
  /** Fields that must agree for two fungible rows to be the same thing; `uniqueKeys` for two unique rows. */
  identity: { keys: string[]; uniqueKeys?: string[] };
  /** Cross-field rules after per-field normalisation; may throw. */
  normalize?(clean: NormalizedItem<F>): NormalizedItem<F>;
  hooks?: {
    /** Runs on every update with the row as it is and as it is about to be; may adjust the latter. */
    beforeUpdate?(existing: ItemRecord<F>, next: NormalizedItem<F>, ctx: HookContext<X>): NormalizedItem<F>;
  };
  /** Items the portfolio total leaves out (consumed, personal). */
  excludeFromPortfolio?(item: ItemRecord<F>): boolean;
  /** How the portfolio explains what it left out, e.g. "opened bottles are not counted". */
  excludedNote?: string;
  /** What one copy is worth now; defaults to the manual value, else the last snapshot. (Not `valueOf`: every object inherits one.) */
  valuation?(item: ItemRecord<F>, snapshot: PriceSnapshot<X> | null | undefined): Valuation;
  allocations?: Array<AllocationSpec<F>>;
  pricing: {
    providers: PriceProvider<Q>[];
    query(item: ItemRecord<F>): Q;
    summarize(args: SummarizeArgs<F, S>): PriceSummary<X>;
    /** How the recorded prices read in the Markdown value table and the history table. */
    describe?(summary: PriceSummary<X>): string;
    /** Keys the owner may type a price under (grades, completeness); empty for a single value. */
    manualKeys?: string[];
    /** Note shown beside the manual-entry source in Settings. */
    manualNote?: string;
    /** How many items are priced at once; sources with a shared rate limit want 1. */
    concurrency?: number;
  };
  settings: { defaults: S; fields: SettingFieldSpec[] };
  alerts?: {
    kinds: Record<string, { label: string; icon: string }>;
    forRefresh?(args: RefreshAlertArgs<F, S, X>): NewAlert[];
  };
  identify?: {
    schema: ZodType;
    systemPrompt: string;
    /** The user turn beside the photos, e.g. "Identify this video game." */
    prompt: string;
    /** Turn what the model said into a record to save. */
    toInput(identification: Identification): ItemInput<F>;
  };
  markdown?: {
    readme?: string;
    /** Extra index.md columns read from each file's front matter. */
    index?: Array<{ header: string; field: string }>;
    /** Extra sections in an item's file, e.g. a service history table. */
    sections?(item: ItemRecord<F>): Array<{ heading: string; body: string }>;
  };
  report: {
    title?: string;
    /** A line under the title, e.g. the insurer and policy number from Settings. */
    preamble?(settings: Settings<S>): string | null;
    columns: Array<{ header: string; value(item: ItemRecord<F>): string; private?: boolean }>;
    note?: string;
  };
  cert?: CertVerifier<F>;
  /** Sample data offered on an empty portfolio. */
  seed?: SeedItem<F>[];
  nav?: NavItem[];
  /** Which nav destinations fit on a phone, in order. */
  tabs?: string[];
  theme: { light: string; dark: string };
  /** Copy for the empty portfolio. */
  emptyNote?: string;
}

/** The camelCase key as a snake_case column and front-matter key. */
export function columnOf(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * The field specs as a client component may receive them: a function (a
 * spreadsheet parser) cannot cross into the browser, and the form has no use
 * for it anyway.
 */
export function clientFields(fields: FieldSpec[]): FieldSpec[] {
  return fields.map((f) => {
    if (!f.parse) return f;
    const { parse: _parse, ...rest } = f;
    void _parse;
    return rest;
  });
}

export function fieldByKey(spec: Pick<DomainSpec, "fields">, key: string): FieldSpec | undefined {
  return spec.fields.find((f) => f.key === key);
}

/** Whether a field is shown in the form and the report given the current values. */
export function conditionHolds(condition: FieldCondition | undefined, values: Record<string, unknown>): boolean {
  if (!condition) return true;
  const v = values[condition.field];
  if (condition.equals !== undefined) return v === condition.equals;
  if (condition.in) return typeof v === "string" && condition.in.includes(v);
  if (condition.truthy) return Boolean(v);
  if (condition.falsy) return !v;
  return true;
}

/** Label for an enum value, or the raw value when it is not an option. */
export function optionLabel(field: FieldSpec | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (field?.type === "enum" && field.options && Object.hasOwn(field.options, String(value))) return field.options[String(value)];
  if (field?.type === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((v) => (field?.options && Object.hasOwn(field.options, String(v)) ? field.options[String(v)] : String(v))).join(", ");
  return String(value);
}
