/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { allocationBy, realizedReturn, totalReturn } from "../domain/analytics";
import type { Engine } from "../domain/engine";
import type { ItemRecord } from "../domain/spec";
import { money, when } from "../format";
import { PrintButton } from "../components/PrintButton";
import { Figure, imageOf, one, pct, plural } from "./shared";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * A printable valuation, written to be handed to somebody: an insurer, an
 * accountant, a buyer. Every figure says where it came from. An item nobody
 * has priced is listed as unpriced and left out of the total rather than
 * counted at zero, and the foot says how many, so a total can never quietly
 * understate a collection.
 *
 * Private fields (a serial number) stay off the page unless asked for with
 * ?private=1, and photos with ?photos=1: an insurer wants both, a buyer neither.
 */
export function ReportPage<F extends object, S extends object, X extends object, Q>({ engine, searchParams }: { engine: Engine<F, S, X, Q>; searchParams: SearchParams }) {
  const { spec, repo } = engine;
  const settings = engine.settings.getSettings();
  const showPrivate = one(searchParams, "private") === "1";
  const showPhotos = one(searchParams, "photos") === "1";
  const items = repo.listItems().filter((i) => i.quantity > 0);
  const latest = repo.latestSnapshotsByItem();
  const priceOf = (item: ItemRecord<F>) => engine.valuation(item, latest.get(item.id)).value;
  const counted = items.filter((i) => engine.counts(i));
  const setAside = items.length - counted.length;

  const rows = items
    .map((item) => ({ item, value: priceOf(item), counts: engine.counts(item) }))
    .sort((a, b) => (b.value ?? 0) * b.item.quantity - (a.value ?? 0) * a.item.quantity);

  const total = rows.reduce((n, r) => n + (r.counts ? (r.value ?? 0) * r.item.quantity : 0), 0);
  const unpriced = rows.filter((r) => r.value === null).length;
  const copies = items.reduce((n, i) => n + i.quantity, 0);
  const basis = engine.ledger.costBasisByItem();
  const returns = totalReturn(counted, priceOf, (item) => basis.get(item.id));
  const realized = realizedReturn(engine.sales.listSales());
  const columns = spec.report.columns.filter((c) => showPrivate || !c.private);
  const hasPrivate = spec.report.columns.some((c) => c.private) || spec.fields.some((f) => f.private);
  const split = spec.allocations?.[0];
  const allocation = split ? allocationBy(counted, split.keyOf, priceOf) : null;
  const toggle = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ private: showPrivate ? "1" : undefined, photos: showPhotos ? "1" : undefined, ...patch })) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/report?${s}` : "/report";
  };

  return (
    <div className="report space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">{spec.report.title ?? `${spec.name} valuation`}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {settings.ownerName ? `${settings.ownerName} · ` : ""}
            {when(new Date().toISOString())}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm print:hidden">
          {hasPrivate && (
            <Link href={toggle({ private: showPrivate ? undefined : "1" })} className="underline decoration-dotted">
              {showPrivate ? "Hide private details" : "Include private details"}
            </Link>
          )}
          <Link href={toggle({ photos: showPhotos ? undefined : "1" })} className="underline decoration-dotted">
            {showPhotos ? "Hide photos" : "Include photos"}
          </Link>
          <PrintButton />
        </div>
      </header>

      {showPrivate && (
        <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--line-strong)" }}>
          This copy includes private details such as serial numbers. Hand it only to whoever needs them.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Figure label={spec.noun.plural} value={String(items.length)} note={plural(copies, "copy", "copies")} />
        <Figure label="Valued at" value={money(total)} note={unpriced > 0 ? `${unpriced} unpriced, not counted` : setAside > 0 ? `${setAside} set aside, not counted` : "everything is priced"} />
        <Figure label="Paid" value={money(returns.invested)} note={returns.copiesWithoutCost > 0 ? `${returns.copiesWithoutCost} copies with no recorded cost` : "for the copies still held"} />
        <Figure label="Unrealised" value={money(returns.amount)} note={returns.percent === null ? "nothing to measure against" : pct(returns.percent)} />
      </section>

      <section>
        <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">Holdings</h2>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              {[...(showPhotos ? ["Photo"] : []), spec.noun.singular, ...columns.map((c) => c.header), "Condition", "Kept in", "Copies", "Each", "Total", "Basis"].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, value, counts }) => (
              <tr key={item.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                {showPhotos && (
                  <td className="px-2 py-1.5">
                    {imageOf(item) ? <img src={imageOf(item)!} alt="" className="h-14 w-14 rounded object-cover" /> : <span style={{ color: "var(--muted)" }}>—</span>}
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <span className="font-medium">{spec.title(item)}</span>
                  {spec.detail(item) && (
                    <span className="block text-xs" style={{ color: "var(--muted)" }}>
                      {spec.detail(item)}
                    </span>
                  )}
                </td>
                {columns.map((c) => (
                  <td key={c.header} className="px-2 py-1.5">
                    {c.value(item) || "—"}
                  </td>
                ))}
                <td className="px-2 py-1.5">{spec.conditionLabel(item)}</td>
                <td className="px-2 py-1.5">{item.location ?? "—"}</td>
                <td className="px-2 py-1.5">{item.quantity}</td>
                <td className="px-2 py-1.5">{value === null ? "unpriced" : money(value)}</td>
                <td className="px-2 py-1.5">{value === null ? "—" : counts ? money(value * item.quantity) : `(${money(value * item.quantity)})`}</td>
                <td className="px-2 py-1.5" style={{ color: "var(--muted)" }}>
                  {engine.valuation(item, latest.get(item.id)).basis}
                  {!counts && " · not counted"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2" style={{ borderColor: "var(--line-strong)" }}>
              <td className="px-2 py-2 font-medium" colSpan={columns.length + (showPhotos ? 6 : 5)}>
                Total
              </td>
              <td className="px-2 py-2 font-medium">{money(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      {split && allocation && allocation.rows.length > 0 && (
        <section>
          <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">By {split.label.toLowerCase()}</h2>
          <table className="w-full max-w-md text-sm">
            <tbody>
              {allocation.rows.map((row) => (
                <tr key={row.key} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-2 py-1.5">{split.labelOf ? split.labelOf(row.key) : row.key}</td>
                  <td className="px-2 py-1.5" style={{ color: "var(--muted)" }}>
                    {row.items}
                  </td>
                  <td className="px-2 py-1.5 text-right">{money(row.value)}</td>
                  <td className="px-2 py-1.5 text-right" style={{ color: "var(--muted)" }}>
                    {(row.share * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {realized.sales > 0 && (
        <section>
          <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">Sold to date</h2>
          <p className="text-sm">
            {plural(realized.copies, "copy", "copies")} across {plural(realized.sales, "sale", "sales")} for {money(realized.proceeds)}, less {money(realized.fees)} in
            fees, against {money(realized.cost)} of cost: a realised {money(realized.gain)}.
            {realized.withoutCost > 0 && <> {realized.withoutCost} of those sales had no recorded cost, so that figure overstates them.</>}
          </p>
        </section>
      )}

      <footer className="border-t pt-3 text-xs" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
        <p>{spec.report.note ?? "Values are what the configured sources last reported for each item, or what the owner recorded by hand, and are estimates."}</p>
        {unpriced > 0 && (
          <p className="mt-1">
            {unpriced} {unpriced === 1 ? "is" : "are"} not priced and left out of the total rather than counted as worth nothing.
          </p>
        )}
        {setAside > 0 && spec.excludedNote && <p className="mt-1">{setAside} set aside: {spec.excludedNote}</p>}
      </footer>
    </div>
  );
}
