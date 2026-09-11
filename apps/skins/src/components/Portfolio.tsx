"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useMemo, useState } from "react";
import { money, when } from "@collectcollect/core/format";
import { ValueChart } from "@collectcollect/core/components/ValueChart";
import { RANGES, change, sliceRange, type PortfolioPoint, type Range, type Realized, type Returns, type Split as Allocation } from "@/lib/analytics";
import { CATEGORIES, RARITIES, type Category, type Rarity } from "@/lib/types";

export interface Holding {
  id: number;
  name: string;
  detail: string;
  image: string | null;
  rarity: Rarity | null;
  quantity: number;
  stackable: boolean;
  value: number;
}

export interface RecentSale {
  id: number;
  itemId: number;
  name: string;
  detail: string;
  soldAt: string;
  quantity: number;
  net: number;
  gain: number | null;
}

interface Props {
  points: PortfolioPoint[];
  itemCount: number;
  copyCount: number;
  pricedCount: number;
  lockedCount: number;
  lastRefreshed: string | null;
  holdings: Holding[];
  returns: Returns;
  byCategory: Allocation<Category>;
  byRarity: Allocation<Rarity>;
  realized: Realized;
  recentSales: RecentSale[];
}

export function Portfolio(props: Props) {
  const { points, itemCount, copyCount, pricedCount, lockedCount, lastRefreshed, holdings, returns, byCategory, byRarity, realized, recentSales } =
    props;
  const [range, setRange] = useState<Range>("ALL");
  const [hover, setHover] = useState<PortfolioPoint | null>(null);

  const shown = useMemo(() => sliceRange(points, range), [points, range]);
  const delta = useMemo(() => change(shown), [shown]);
  const latest = points.length ? points[points.length - 1].value : 0;
  const headline = hover ? hover.value : latest;
  const up = delta.amount >= 0;

  return (
    <div className="reveal space-y-8">
      <section>
        <p className="label">Inventory value</p>
        <p className="hero-figure text-5xl sm:text-6xl">{money(headline)}</p>
        <p className="mt-1 text-sm">
          <span className={up ? "delta-up" : "delta-down"}>
            <span aria-hidden>{up ? "▲" : "▼"}</span> {money(Math.abs(delta.amount))}
            {delta.percent !== null && ` (${up ? "+" : "−"}${Math.abs(delta.percent).toFixed(1)}%)`}
          </span>
          <span style={{ color: "var(--muted)" }}>
            {" "}
            {range === "ALL" ? "all time" : `over ${range}`}
            {lastRefreshed && ` · priced ${when(lastRefreshed)}`}
          </span>
        </p>

        <div className="mt-4 flex gap-1" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition"
              style={
                range === r
                  ? { background: "var(--surface-raised)", color: "var(--foreground)" }
                  : { color: "var(--muted)" }
              }
            >
              {r}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <ValueChart
            points={shown}
            up={up}
            onHover={setHover}
            label="Inventory value over time"
            empty="No price history yet. Once prices are recorded, the chart starts here."
            detail={(p) => `${p.priced} item${p.priced === 1 ? "" : "s"} priced`}
          />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Items" value={String(itemCount)} note={`${copyCount} cop${copyCount === 1 ? "y" : "ies"}`} />
          <Stat label="Priced" value={`${pricedCount} of ${itemCount}`} note={pricedCount < itemCount ? "the rest are unvalued" : "all of them"} />
          <Stat
            label="Unrealised"
            value={money(returns.amount)}
            note={returns.percent === null ? "against nothing recorded" : `${returns.percent >= 0 ? "+" : "−"}${Math.abs(returns.percent).toFixed(1)}% on ${money(returns.invested)}`}
            tone={returns.amount >= 0 ? "up" : "down"}
          />
          <Stat
            label="Trade locked"
            value={String(lockedCount)}
            note={lockedCount ? "cannot be sold yet" : "everything can move"}
          />
        </dl>

        {(returns.copiesWithoutCost > 0 || returns.itemsAwaitingPrice > 0) && (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            {returns.copiesWithoutCost > 0 && (
              <>
                {returns.copiesWithoutCost} cop{returns.copiesWithoutCost === 1 ? "y" : "ies"} arrived without a recorded
                price and {returns.copiesWithoutCost === 1 ? "is" : "are"} left out of the return rather than counted as
                free.{" "}
              </>
            )}
            {returns.itemsAwaitingPrice > 0 && <>{returns.itemsAwaitingPrice} bought but not yet priced.</>}
          </p>
        )}
      </section>

      {holdings.length > 0 && (
        <section>
          <h2 className="font-display mb-3 text-lg font-semibold uppercase tracking-wide">Top holdings</h2>
          <ul className="space-y-2">
            {holdings.map((h) => {
              const rarity = h.rarity ? RARITIES[h.rarity] : null;
              return (
                <li key={h.id}>
                  <Link
                    href={`/items/${h.id}`}
                    className="card-surface flex items-center gap-3 p-2 transition hover:border-[var(--line-strong)]"
                  >
                    <span
                      aria-hidden
                      className="h-10 w-1 shrink-0 rounded-full"
                      style={{ background: rarity?.color ?? "var(--line-strong)" }}
                    />
                    <span className="well flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded">
                      {h.image ? <img src={h.image} alt="" className="h-full w-full object-contain" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.name}</span>
                      <span className="block truncate text-xs" style={{ color: "var(--muted)" }}>
                        {h.detail}
                        {h.stackable && h.quantity !== 1 && ` · ×${h.quantity}`}
                      </span>
                    </span>
                    <span className="hero-figure shrink-0 text-base">{money(h.value)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        {byCategory.rows.length > 0 && (
          <SplitChart
            title="By kind"
            rows={byCategory.rows.map((a) => ({ label: CATEGORIES[a.key], color: null, ...a }))}
            unclassified={byCategory}
            unclassifiedNote="of no particular kind"
          />
        )}
        {byRarity.rows.length > 0 && (
          <SplitChart
            title="By rarity"
            rows={byRarity.rows.map((a) => ({ label: RARITIES[a.key].label, color: RARITIES[a.key].color, ...a }))}
            unclassified={byRarity}
            unclassifiedNote="has no rarity recorded"
          />
        )}
      </div>

      {realized.sales > 0 && (
        <section>
          <h2 className="font-display mb-3 text-lg font-semibold uppercase tracking-wide">Sold</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Proceeds" value={money(realized.proceeds)} note={`${realized.copies} cop${realized.copies === 1 ? "y" : "ies"}`} />
            <Stat label="Fees" value={money(realized.fees)} note="what the markets kept" />
            <Stat label="Cost" value={money(realized.cost)} note="of the copies sold" />
            <Stat
              label="Realised"
              value={money(realized.gain)}
              note={realized.percent === null ? "no cost recorded" : `${realized.percent >= 0 ? "+" : "−"}${Math.abs(realized.percent).toFixed(1)}%`}
              tone={realized.gain >= 0 ? "up" : "down"}
            />
          </dl>
          {realized.withoutCost > 0 && (
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              {realized.withoutCost} sale{realized.withoutCost === 1 ? "" : "s"} had no recorded cost, so the realised
              figure understates {realized.withoutCost === 1 ? "it" : "them"}.
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {recentSales.map((s) => (
              <li key={s.id} className="card-surface flex items-center gap-3 p-2 text-sm">
                <Link href={`/items/${s.itemId}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block truncate text-xs" style={{ color: "var(--muted)" }}>
                    {s.detail} · {s.soldAt.slice(0, 10)}
                    {s.quantity > 1 && ` · ×${s.quantity}`}
                  </span>
                </Link>
                <span className="shrink-0 text-right">
                  <span className="block">{money(s.net)}</span>
                  <span className="block text-xs" style={{ color: "var(--muted)" }}>
                    {s.gain === null ? "cost unknown" : <span className={s.gain >= 0 ? "delta-up" : "delta-down"}>{money(s.gain)}</span>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {itemCount === 0 && (
        <section className="card-surface p-6 text-center">
          <p className="font-display text-lg font-semibold">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: "var(--muted)" }}>
            Bring in a whole inventory from Steam or a spreadsheet, or add one item by hand. Once something is here,
            this page becomes what it is worth, how that moves, and where it would sell for most.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/import" className="btn-primary">
              Import an inventory
            </Link>
            <Link href="/add" className="btn-secondary">
              Add an item
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "up" | "down" }) {
  return (
    <div className="card-surface p-3">
      <dt className="label mb-0.5">{label}</dt>
      <dd>
        <span className={`hero-figure text-xl ${tone === "up" ? "delta-up" : tone === "down" ? "delta-down" : ""}`}>{value}</span>
        {note && (
          <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * A share-of-value breakdown. The bar is the fast read and the percentage is
 * printed beside it, so the split is legible without comparing bar lengths.
 *
 * Shares are of the whole inventory, not of the rows shown, so they will not
 * add up to 100% when something falls outside the grouping — and what is
 * missing is named underneath rather than quietly absorbed into the rest.
 */
function SplitChart({
  title,
  rows,
  unclassified,
  unclassifiedNote,
}: {
  title: string;
  rows: Array<{ label: string; color: string | null; value: number; items: number; share: number }>;
  unclassified: { unclassified: number; unclassifiedShare: number };
  unclassifiedNote: string;
}) {
  return (
    <section>
      <h2 className="font-display mb-3 text-lg font-semibold uppercase tracking-wide">{title}</h2>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>
                {row.label}
                <span className="ml-1.5 text-xs" style={{ color: "var(--muted)" }}>
                  {row.items}
                </span>
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {money(row.value)}
                <span className="ml-1.5 text-xs" style={{ color: "var(--muted)" }}>
                  {(row.share * 100).toFixed(0)}%
                </span>
              </span>
            </div>
            <div className="well mt-1 h-1.5 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(1, row.share * 100)}%`, background: row.color ?? "var(--chart-series-1)" }}
              />
            </div>
          </li>
        ))}
      </ul>
      {unclassified.unclassified > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          {money(unclassified.unclassified)} ({(unclassified.unclassifiedShare * 100).toFixed(0)}%) {unclassifiedNote}, so
          these do not add up to the whole.
        </p>
      )}
    </section>
  );
}
