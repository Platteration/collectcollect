import Link from "next/link";
import { money } from "@collectcollect/core/format";
import { spreadView, type SpreadRow } from "@/lib/spread";
import { listItems } from "@/lib/items";
import { RefreshPrices } from "@/components/RefreshPrices";

export const dynamic = "force-dynamic";

export default function SpreadPage() {
  const view = spreadView();
  const total = view.worthDoing.reduce((n, row) => n + (row.locked ? 0 : row.total), 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Where to sell</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          What each item would actually pay, market by market, after fees.
          Steam is never compared against the others: its proceeds are wallet
          funds that cannot be withdrawn, so putting it in the same ranking
          would point you somewhere you would not be paid.
        </p>
      </header>

      <RefreshPrices items={listItems().length} />

      {view.worthDoing.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Worth moving</h2>
          <p className="text-sm">
            {view.worthDoing.length} item{view.worthDoing.length === 1 ? "" : "s"} where one market pays at least{" "}
            {view.settings.spreadMinPercent}% more per copy than another, and moving what you hold is worth at least{" "}
            {money(view.settings.spreadMinAmount)}.
            {total > 0 && (
              <>
                {" "}
                Together that is <strong>{money(total)}</strong>
                {view.lockedCount > 0 && <> from the ones you can act on today</>}.
              </>
            )}
          </p>
          {view.lockedCount > 0 && (
            <p className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
              {view.lockedCount} of them {view.lockedCount === 1 ? "is" : "are"} trade locked, so{" "}
              {view.lockedCount === 1 ? "its" : "their"} difference is left out of that total.
            </p>
          )}
          <ul className="space-y-2">
            {view.worthDoing.map((row) => (
              <Row key={row.item.id} row={row} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="card-surface p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          {view.slim.length > 0
            ? "Nothing is far enough apart to be worth moving right now."
            : "Nothing to compare yet. Refresh prices, and anything two markets both list will show up here."}
        </p>
      )}

      {view.slim.length > 0 && (
        <details className="space-y-3">
          <summary className="font-display cursor-pointer text-lg font-semibold uppercase tracking-wide">
            The other {view.slim.length} with a difference too small to bother
          </summary>
          <ul className="mt-3 space-y-2">
            {view.slim.map((row) => (
              <Row key={row.item.id} row={row} />
            ))}
          </ul>
        </details>
      )}

      {(view.noComparison > 0 || view.unpriced > 0) && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {view.noComparison > 0 && (
            <>
              {view.noComparison} item{view.noComparison === 1 ? " has" : "s have"} only one market listing{" "}
              {view.noComparison === 1 ? "it" : "them"}, so there is nothing to compare.{" "}
            </>
          )}
          {view.unpriced > 0 && (
            <>
              {view.unpriced} {view.unpriced === 1 ? "has" : "have"} no price at all yet.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Row({ row }: { row: SpreadRow }) {
  const best = row.cash[0];
  const worst = row.cash[row.cash.length - 1];
  return (
    <li className="card-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/items/${row.item.id}`} className="font-medium hover:underline">
          {row.item.marketHashName}
          {row.item.quantity > 1 && (
            <span className="ml-1.5 text-xs" style={{ color: "var(--muted)" }}>
              ×{row.item.quantity}
            </span>
          )}
        </Link>
        <span className="hero-figure text-lg">
          +{money(row.total)}
          {row.item.quantity > 1 && (
            <span className="ml-1.5 text-xs font-normal" style={{ color: "var(--muted)" }}>
              {money(row.gap)} each
            </span>
          )}
        </span>
      </div>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        {best.label} nets {money(best.net)} · {worst.label} nets {money(worst.net)}
        {row.wallet.length > 0 && (
          <>
            {" "}
            · {row.wallet[0].label} would show {money(row.wallet[0].net)} in wallet funds
          </>
        )}
      </p>
      {row.locked && (
        <p className="mt-1 text-sm" style={{ color: "var(--chart-bad-text)" }}>
          Trade locked until {row.tradableAfter!.slice(0, 10)} — not actionable yet.
        </p>
      )}
    </li>
  );
}
