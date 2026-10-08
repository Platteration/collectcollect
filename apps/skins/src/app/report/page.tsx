import { money, when } from "@collectcollect/core/format";
import { PrintButton } from "@collectcollect/core/components/PrintButton";
import { costBasisByItem, latestSnapshotsByItem, listItems } from "@/lib/items";
import { allocationBy, realizedReturn, totalReturn } from "@/lib/analytics";
import { listSales } from "@/lib/sales";
import { getSettings } from "@/lib/settings";
import { valueOf } from "@/lib/valuation";
import { CATEGORIES, EXTERIORS, RARITIES } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * A printable valuation.
 *
 * Written to be handed to somebody — an insurer, an accountant, a person you
 * are selling to — which means every figure has to say where it came from. An
 * item nobody has priced is listed as unpriced and left out of the total rather
 * than counted at zero, and the note at the foot says how many, so a total can
 * never quietly understate a collection.
 */
export default function ReportPage() {
  const settings = getSettings();
  const items = listItems().filter((i) => i.quantity > 0);
  const latest = latestSnapshotsByItem();
  const priceOf = (item: (typeof items)[number]) => valueOf(item, latest.get(item.id)).value;

  const rows = items
    .map((item) => ({ item, value: priceOf(item) }))
    .sort((a, b) => (b.value ?? 0) * b.item.quantity - (a.value ?? 0) * a.item.quantity);

  const total = rows.reduce((n, r) => n + (r.value ?? 0) * r.item.quantity, 0);
  const unpriced = rows.filter((r) => r.value === null).length;
  const copies = items.reduce((n, i) => n + i.quantity, 0);
  const basis = costBasisByItem();
  const returns = totalReturn(items, priceOf, (item) => basis.get(item.id));
  const realized = realizedReturn(listSales());
  const byCategory = allocationBy(items, (i) => i.category, priceOf);

  return (
    <div className="report space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Inventory valuation</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {settings.ownerName ? `${settings.ownerName} · ` : ""}
            {when(new Date().toISOString())}
          </p>
        </div>
        <div className="print:hidden">
          <PrintButton />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Figure label="Items" value={String(items.length)} note={`${copies} cop${copies === 1 ? "y" : "ies"}`} />
        <Figure label="Valued at" value={money(total)} note={unpriced > 0 ? `${unpriced} unpriced, not counted` : "everything is priced"} />
        <Figure
          label="Paid"
          value={money(returns.invested)}
          note={returns.copiesWithoutCost > 0 ? `${returns.copiesWithoutCost} copies with no recorded cost` : "for the copies still held"}
        />
        <Figure
          label="Unrealised"
          value={money(returns.amount)}
          note={returns.percent === null ? "nothing to measure against" : `${returns.percent >= 0 ? "+" : "−"}${Math.abs(returns.percent).toFixed(1)}%`}
        />
      </section>

      {items.length === 0 && (
        <p className="card-surface p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          Nothing is held yet, so there is nothing to value. Bring an inventory in and price it, and this page becomes
          a document you can hand to somebody.
        </p>
      )}

      <section>
        <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">Holdings</h2>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              {["Item", "Kind", "Wear", "Float", "Rarity", "Copies", "Each", "Total", "Basis"].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, value }) => (
              <tr key={item.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="px-2 py-1.5">{item.marketHashName}</td>
                <td className="px-2 py-1.5">{CATEGORIES[item.category]}</td>
                <td className="px-2 py-1.5">{item.exterior ? EXTERIORS[item.exterior] : "—"}</td>
                <td className="px-2 py-1.5" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {item.floatValue === null ? "—" : Number(item.floatValue.toFixed(6))}
                </td>
                <td className="px-2 py-1.5">{item.rarity ? RARITIES[item.rarity].label : "—"}</td>
                <td className="px-2 py-1.5">{item.quantity}</td>
                <td className="px-2 py-1.5">{value === null ? "unpriced" : money(value)}</td>
                <td className="px-2 py-1.5">{value === null ? "—" : money(value * item.quantity)}</td>
                <td className="px-2 py-1.5" style={{ color: "var(--muted)" }}>
                  {valueOf(item, latest.get(item.id)).basis}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2" style={{ borderColor: "var(--line-strong)" }}>
              <td className="px-2 py-2 font-medium" colSpan={7}>
                Total
              </td>
              <td className="px-2 py-2 font-medium">{money(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      {byCategory.rows.length > 0 && (
        <section>
          <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">By kind</h2>
          <table className="w-full max-w-md text-sm">
            <tbody>
              {byCategory.rows.map((row) => (
                <tr key={String(row.key)} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-2 py-1.5">{CATEGORIES[row.key]}</td>
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
            {realized.copies} cop{realized.copies === 1 ? "y" : "ies"} across {realized.sales} sale
            {realized.sales === 1 ? "" : "s"} for {money(realized.proceeds)}, less {money(realized.fees)} in fees,
            against {money(realized.cost)} of cost — a realised {money(realized.gain)}.
            {realized.withoutCost > 0 && (
              <> {realized.withoutCost} of those sales had no recorded cost, so that figure understates them.</>
            )}
          </p>
        </section>
      )}

      <footer className="border-t pt-3 text-xs" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
        <p>
          Values are the highest price a market was showing when each item was
          last priced, before that market&rsquo;s fees. What an item would
          actually pay after fees is on its own page, and differs by market.
        </p>
        {unpriced > 0 && (
          <p className="mt-1">
            {unpriced} item{unpriced === 1 ? " is" : "s are"} not priced and {unpriced === 1 ? "is" : "are"} left out of
            the total rather than counted as worth nothing.
          </p>
        )}
      </footer>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card-surface p-3">
      <p className="label mb-0.5">{label}</p>
      <p className="hero-figure text-xl">{value}</p>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {note}
      </p>
    </div>
  );
}
