/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Engine } from "../domain/engine";
import type { Acquisition } from "../domain/acquisitions";
import type { ItemRecord, PriceSnapshot, PriceSummary, Sale, Settings } from "../domain/spec";
import { clientFields, conditionHolds, optionLabel } from "../domain/spec";
import { money, when } from "../format";
import { CertCheck } from "../components/domain/CertCheck";
import { EditItem } from "../components/domain/EditItem";
import { Ledger } from "../components/domain/Ledger";
import { PricePanel } from "../components/domain/PricePanel";
import { ValueChart } from "../components/ValueChart";
import { imageOf, photoHref, SectionTitle, Table } from "./shared";

/** What a domain may add to the standard item page, given everything the page already loaded. */
export interface ItemPageContext<F extends object, S extends object, X extends object> {
  item: ItemRecord<F>;
  snapshots: PriceSnapshot<X>[];
  latest: PriceSummary<X> | null;
  settings: Settings<S>;
  acquisitions: Acquisition[];
  sales: Sale[];
}

export interface ItemPageExtras {
  /** Under the title, e.g. a slab label. */
  header?: React.ReactNode;
  /** Between the price panel and the record, e.g. a grading outlook chart. */
  afterPrice?: React.ReactNode;
  /** After everything else, e.g. a service history. */
  end?: React.ReactNode;
  /** Named prices from the latest summary the price panel should list (graded, completeness). */
  named?: Array<{ label: string; value: number; estimated?: boolean }>;
  /** Keys of fields the domain renders itself, so the facts grid leaves them out. */
  handled?: string[];
  /** A sentence about the value, beside the basis (e.g. "frozen when opened"). */
  valueNote?: string;
}

interface Props<F extends object, S extends object, X extends object, Q> {
  engine: Engine<F, S, X, Q>;
  params: Promise<{ id: string }>;
  extras?: (ctx: ItemPageContext<F, S, X>) => ItemPageExtras;
}

/**
 * One item in full: its picture, what it is worth and why, its record, the
 * money behind it and every value ever recorded for it. The domain adds what
 * only it knows about through `extras`; everything else is the same page in
 * every app.
 */
export async function ItemPage<F extends object, S extends object, X extends object, Q>({ engine, params, extras }: Props<F, S, X, Q>) {
  const { spec, repo } = engine;
  const { id } = await params;
  const n = Number(id);
  const item = Number.isInteger(n) ? repo.getItem(n) : null;
  if (!item) notFound();

  const snapshots = repo.listSnapshots(item.id);
  const latest = snapshots[0] ?? null;
  const settings = engine.settings.getSettings();
  const acquisitions = engine.ledger.listLots(item.id);
  const sales = engine.sales.listSalesForItem(item.id);
  const { value, basis } = engine.valuation(item, latest);
  const unique = spec.isUnique(item);
  const counted = engine.counts(item);
  const add = extras ? extras({ item, snapshots, latest: latest?.summary ?? null, settings, acquisitions, sales }) : {};
  const handled = new Set(add.handled ?? []);
  const values = item as Record<string, unknown>;

  const facts = spec.fields
    .filter((f) => f.key !== spec.titleField && !handled.has(f.key) && f.type !== "json" && conditionHolds(f.showWhen, values))
    .map((f) => ({ label: f.label, value: optionLabel(f, values[f.key]), key: f.key }))
    .filter((f) => f.value !== "");

  const history = [...snapshots].reverse().filter((s) => s.summary.yourCopyValue !== null).map((s) => ({ t: s.fetchedAt, value: s.summary.yourCopyValue as number }));
  const up = history.length < 2 || history[history.length - 1].value >= history[0].value;
  const hasSources = spec.pricing.providers.some((p) => p.isConfigured() && p.id !== "manual");
  const certApplies = spec.cert && (spec.cert.applies ? spec.cert.applies(item) : true);
  const image = imageOf(item);

  return (
    <div className={`reveal -mx-4 space-y-6 px-4 py-4 sm:mx-0 sm:rounded-xl sm:px-6 ${item.accentColor ? "accent-wash" : ""}`} style={item.accentColor ? ({ "--accent": item.accentColor } as React.CSSProperties) : undefined}>
      <nav className="text-xs" style={{ color: "var(--muted)" }}>
        <Link href="/collection" className="hover:underline">
          Collection
        </Link>
        {" / "}
        {spec.detail(item) || spec.noun.singular}
      </nav>

      <header className="flex flex-wrap items-start gap-4">
        <div className="well flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg sm:h-48 sm:w-48">
          {image ? (
            <img src={image} alt="" className="h-full w-full object-contain p-2" />
          ) : (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              No photo
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold leading-tight">{spec.title(item)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: "var(--muted)" }}>
            <span className="badge border" style={{ borderColor: "var(--line-strong)", color: "var(--foreground)" }}>
              {spec.conditionLabel(item)}
            </span>
            {spec.detail(item) && <span>{spec.detail(item)}</span>}
            {!unique && <span>· {item.quantity === 0 ? "sold out" : `×${item.quantity}`}</span>}
            {item.quantity === 0 && unique && <span>· sold</span>}
          </p>
          {add.header}
          <p className="hero-figure mt-3 text-4xl">{value === null ? "Not priced" : money(value)}</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {basis}
            {!unique && item.quantity > 1 && value !== null && ` · ${money(value * item.quantity)} for ${item.quantity}`}
            {item.purchasePrice !== null && ` · paid ${money(item.purchasePrice)}${!unique && item.quantity > 1 ? " each" : ""}`}
            {add.valueNote && ` · ${add.valueNote}`}
            {!counted && item.quantity > 0 && " · not counted in the portfolio total"}
          </p>
          {item.location && (
            <p className="mt-2 text-sm">
              Kept in <span className="font-medium">{item.location}</span>
            </p>
          )}
        </div>
      </header>

      <PricePanel
        itemId={item.id}
        summary={(latest?.summary as (PriceSummary<X> & Record<string, unknown>) | undefined) ?? null}
        manualValue={item.manualValue}
        manualPrices={item.manualPrices}
        manualKeys={spec.pricing.manualKeys ?? []}
        hasSources={hasSources}
        named={add.named}
      />

      {add.afterPrice}

      {certApplies && spec.cert && <CertCheck itemId={item.id} label={spec.cert.label} note={spec.cert.note} />}

      {item.photos.length > 1 && (
        <section>
          <SectionTitle>Photos</SectionTitle>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {item.photos.map((name) => (
              <li key={name} className="well overflow-hidden rounded-lg">
                <a href={photoHref(name)} target="_blank" rel="noreferrer">
                  <img src={photoHref(name)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EditItem fields={clientFields(spec.fields)} item={item as Record<string, unknown> & ItemRecord<F>} unique={unique} noun={spec.noun.singular} locations={repo.listLocations().map((l) => l.location)} />

      {facts.length > 0 && (
        <section>
          <SectionTitle>Record</SectionTitle>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
            {facts.map((f) => (
              <div key={f.key} className="card-surface p-3">
                <dt className="label mb-0.5">{f.label}</dt>
                <dd className="break-words">{f.value}</dd>
              </div>
            ))}
            <div className="card-surface p-3">
              <dt className="label mb-0.5">Added</dt>
              <dd>{when(item.createdAt)}</dd>
            </div>
          </dl>
        </section>
      )}

      {item.notes && (
        <section>
          <SectionTitle>Notes</SectionTitle>
          <p className="whitespace-pre-wrap text-sm">{item.notes}</p>
        </section>
      )}

      {item.identification && (
        <section className="card-surface p-4 text-sm">
          <h2 className="label">Identified from the photo</h2>
          <p>
            Confidence {Math.round(item.identification.confidence * 100)}%.
            {item.identification.alternatives.length > 0 && " It could also have been:"}
          </p>
          {item.identification.alternatives.length > 0 && (
            <ul className="mt-1 list-disc pl-5" style={{ color: "var(--muted)" }}>
              {item.identification.alternatives.map((a, i) => (
                <li key={i}>
                  {a.label}
                  {a.reason && ` — ${a.reason}`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Ledger itemId={item.id} held={item.quantity} unique={unique} acquisitions={acquisitions} sales={sales} />

      {history.length > 0 && (
        <section>
          <SectionTitle>Value over time</SectionTitle>
          <div className="card-surface p-4">
            <ValueChart points={history} up={up} label="Your copy" height={200} empty="No values recorded yet" />
          </div>
        </section>
      )}

      {snapshots.length > 0 && (
        <section>
          <SectionTitle>Value history</SectionTitle>
          <Table
            headers={["Date", "Your copy", "Basis", "Sources"]}
            rows={snapshots.map((s) => [
              s.fetchedAt.slice(0, 10),
              s.summary.yourCopyValue === null ? "—" : money(s.summary.yourCopyValue),
              s.summary.yourCopyBasis || "—",
              <span key="src" style={{ color: "var(--muted)" }}>
                {describe(engine, s.summary) || "—"}
              </span>,
            ])}
          />
        </section>
      )}

      {add.end}
    </div>
  );
}

function describe<F extends object, S extends object, X extends object, Q>(engine: Engine<F, S, X, Q>, summary: PriceSummary<X>): string {
  if (engine.spec.pricing.describe) return engine.spec.pricing.describe(summary);
  return summary.quotes
    .filter((q) => q.price !== null)
    .map((q) => `${q.sourceLabel} ${money(q.price)}`)
    .join(" · ");
}
