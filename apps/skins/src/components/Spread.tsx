import { money } from "@collectcollect/core/format";
import type { MarketProceeds } from "@/lib/pricing/index";

/**
 * Where an item is worth most, net of what each market keeps.
 *
 * Two tables, never one. Steam is where most CS2 trading happens and it often
 * shows the highest number — but what it pays is wallet funds that cannot be
 * withdrawn, so putting it in the same ranking as markets that pay money would
 * be a lie of the most useful-looking kind. The split is the honesty; the
 * arithmetic is trivial.
 *
 * A trade lock is the other half of it. A spread you cannot act on for six days
 * is not a spread, so a locked item says so above the numbers rather than
 * underneath them.
 */
export function Spread({
  cash,
  wallet,
  quantity,
  lockedUntil,
}: {
  cash: MarketProceeds[];
  wallet: MarketProceeds[];
  quantity: number;
  lockedUntil: string | null;
}) {
  if (cash.length === 0 && wallet.length === 0) return null;

  const best = cash[0] ?? null;
  const worst = cash.length > 1 ? cash[cash.length - 1] : null;
  const gap = best && worst ? Math.round((best.net - worst.net) * 100) / 100 : null;

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Where it is worth most</h2>

      {lockedUntil && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }}>
          Trade locked until {lockedUntil.slice(0, 10)}. None of this can be acted on until then.
        </p>
      )}

      {gap !== null && gap > 0 && best && worst && (
        <p className="text-sm">
          <strong>{best.label}</strong> nets {money(gap)} more than {worst.label}
          {quantity > 1 && <> per copy, or {money(gap * quantity)} across {quantity}</>}.
        </p>
      )}

      {cash.length > 0 && (
        <MarketTable
          caption="Markets that pay money"
          rows={cash}
          quantity={quantity}
          note="These pay out to a bank account or a card."
        />
      )}

      {wallet.length > 0 && (
        <MarketTable
          caption="Steam wallet"
          rows={wallet}
          quantity={quantity}
          note="Listed apart because these proceeds cannot be withdrawn. They buy games; they are not money."
        />
      )}
    </section>
  );
}

function MarketTable({
  caption,
  rows,
  quantity,
  note,
}: {
  caption: string;
  rows: MarketProceeds[];
  quantity: number;
  note: string;
}) {
  return (
    <div>
      <div className="card-surface overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="label px-3 pt-3 text-left">{caption}</caption>
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">
                Market
              </th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">
                Listed at
              </th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">
                You get
              </th>
              {quantity > 1 && (
                <th scope="col" className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">
                  For {quantity}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.market} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="px-3 py-2">{row.label}</td>
                <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {money(row.price)}
                </td>
                <td className="px-3 py-2 text-right font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {money(row.net)}
                </td>
                {quantity > 1 && (
                  <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {money(row.net * quantity)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        {note} Fees are the ones you set in Settings.
      </p>
    </div>
  );
}
