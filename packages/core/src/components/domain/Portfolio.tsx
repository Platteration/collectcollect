"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../api-client";
import { money, when } from "../../format";
import { ValueChart } from "../ValueChart";
import { RANGES, change, sliceRange, type PortfolioPoint, type Range, type Realized, type Returns } from "../../domain/analytics";

export interface Holding {
  id: number;
  title: string;
  detail: string;
  condition: string;
  image: string | null;
  quantity: number;
  unique: boolean;
  value: number;
}

export interface RecentSale {
  id: number;
  itemId: number;
  title: string;
  detail: string;
  soldAt: string;
  quantity: number;
  net: number;
  gain: number | null;
}

export interface AllocationView {
  id: string;
  label: string;
  rows: Array<{ key: string; label: string; color: string | null; value: number; items: number; share: number }>;
  unclassified: number;
  unclassifiedShare: number;
  unclassifiedNote: string;
}

interface Props {
  noun: { singular: string; plural: string };
  points: PortfolioPoint[];
  itemCount: number;
  copyCount: number;
  pricedCount: number;
  /** Items kept in the collection but left out of the total (opened, consumed, personal). */
  excludedCount: number;
  excludedNote?: string;
  lastRefreshed: string | null;
  holdings: Holding[];
  returns: Returns;
  allocations: AllocationView[];
  realized: Realized;
  recentSales: RecentSale[];
  emptyNote: string;
  hasSeed: boolean;
  children?: React.ReactNode;
}

export function Portfolio(props: Props) {
  const { noun, points, itemCount, copyCount, pricedCount, excludedCount, excludedNote, lastRefreshed, holdings, returns, allocations, realized, recentSales, emptyNote, hasSeed, children } = props;
  const router = useRouter();
  const [range, setRange] = useState<Range>("ALL");
  const [hover, setHover] = useState<PortfolioPoint | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const shown = useMemo(() => sliceRange(points, range), [points, range]);
  const delta = useMemo(() => change(shown), [shown]);
  const latest = points.length ? points[points.length - 1].value : 0;
  const headline = hover ? hover.value : latest;
  const up = delta.amount >= 0;
  const split = allocationsFor(allocations);

  const refreshAll = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const { result } = await api<{ result: { refreshed: number; unpriced: number; failed: unknown[]; providerErrors: Array<{ source: string; message: string }> } }>("/api/prices/refresh", { method: "POST" });
      const parts = [`${result.refreshed} priced`];
      if (result.unpriced) parts.push(`${result.unpriced} returned no price (previous values kept)`);
      if (result.failed.length) parts.push(`${result.failed.length} failed`);
      for (const e of result.providerErrors) parts.push(`${e.source}: ${e.message}`);
      setMessage(parts.join(", ") + ".");
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      await api("/api/seed", { method: "POST" });
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  if (itemCount === 0 && realized.sales === 0) {
    return (
      <div className="card-surface flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-lg font-medium">Nothing here yet</p>
        <p className="max-w-md text-sm" style={{ color: "var(--muted)" }}>
          {emptyNote}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/add" className="btn-primary">
            Add your first {noun.singular}
          </Link>
          {hasSeed && (
            <button type="button" className="btn-secondary" onClick={seed} disabled={seeding}>
              {seeding ? "Loading…" : "Load sample data"}
            </button>
          )}
        </div>
        {message && (
          <p className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="reveal space-y-8">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label">Collection value</p>
            <p className="hero-figure text-5xl sm:text-6xl">{money(headline)}</p>
            <p className="mt-1 text-sm">
              <span className={up ? "delta-up" : "delta-down"}>
                <span aria-hidden>{up ? "▲" : "▼"}</span> {money(Math.abs(delta.amount))}
                {delta.percent !== null && ` (${up ? "+" : "−"}${Math.abs(delta.percent).toFixed(1)}%)`}
              </span>
              <span style={{ color: "var(--muted)" }}>
                {" "}
                {hover ? `on ${when(hover.t)}` : range === "ALL" ? "all time" : `over ${range}`}
              </span>
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <button type="button" className="btn-secondary" onClick={refreshAll} disabled={refreshing || itemCount === 0}>
              {refreshing ? "Refreshing…" : "Refresh all prices"}
            </button>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {message ?? (lastRefreshed ? `Last priced ${when(lastRefreshed)}` : "Never priced")}
            </span>
          </div>
        </div>

        <div className="mt-4 flex gap-1" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition"
              style={range === r ? { background: "var(--surface-raised)", color: "var(--foreground)" } : { color: "var(--muted)" }}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <ValueChart points={shown} up={up} onHover={setHover} label="Collection value over time" empty="No price history yet. Once prices are recorded, the chart starts here." detail={(p) => `${p.priced} ${p.priced === 1 ? noun.singular : noun.plural} priced`} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label={capitalize(noun.plural)} value={String(itemCount)} note={`${copyCount} cop${copyCount === 1 ? "y" : "ies"}`} />
          <Stat label="Priced" value={`${pricedCount} of ${itemCount}`} note={pricedCount < itemCount ? "the rest are unvalued" : "all of them"} />
          <Stat
            label="Unrealised"
            value={money(returns.amount)}
            note={returns.percent === null ? "against nothing recorded" : `${returns.percent >= 0 ? "+" : "−"}${Math.abs(returns.percent).toFixed(1)}% on ${money(returns.invested)}`}
            tone={returns.amount >= 0 ? "up" : "down"}
          />
          <Stat label="Realised" value={money(realized.gain)} note={realized.sales ? `${realized.sales} sale${realized.sales === 1 ? "" : "s"}` : "nothing sold yet"} tone={realized.sales ? (realized.gain >= 0 ? "up" : "down") : undefined} />
        </dl>

        {(returns.copiesWithoutCost > 0 || returns.itemsAwaitingPrice > 0 || excludedCount > 0) && (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            {returns.copiesWithoutCost > 0 && <>{returns.copiesWithoutCost} cop{returns.copiesWithoutCost === 1 ? "y" : "ies"} arrived without a recorded price and {returns.copiesWithoutCost === 1 ? "is" : "are"} left out of the return rather than counted as free. </>}
            {returns.itemsAwaitingPrice > 0 && <>{returns.itemsAwaitingPrice} bought but not yet priced. </>}
            {excludedCount > 0 && <>{excludedCount} {excludedNote ?? "left out of the total"}.</>}
          </p>
        )}
      </section>

      {children}

      {holdings.length > 0 && (
        <section>
          <h2 className="font-display mb-3 text-lg font-semibold uppercase tracking-wide">Top holdings</h2>
          <ul className="space-y-2">
            {holdings.map((h) => (
              <li key={h.id}>
                <Link href={`/items/${h.id}`} className="card-surface flex items-center gap-3 p-2 transition hover:border-[var(--line-strong)]">
                  <span className="well flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded">{h.image ? <img src={h.image} alt="" className="h-full w-full object-cover" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{h.title}</span>
                    <span className="block truncate text-xs" style={{ color: "var(--muted)" }}>
                      {[h.detail, h.condition].filter(Boolean).join(" · ")}
                      {!h.unique && h.quantity !== 1 && ` · ×${h.quantity}`}
                    </span>
                  </span>
                  <span className="hero-figure shrink-0 text-base">{money(h.value)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {split.length > 0 && (
        <div className="grid gap-8 md:grid-cols-2">
          {split.map((a) => (
            <SplitChart key={a.id} view={a} />
          ))}
        </div>
      )}

      {realized.sales > 0 && (
        <section>
          <h2 className="font-display mb-3 text-lg font-semibold uppercase tracking-wide">Sold</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Proceeds" value={money(realized.proceeds)} note={`${realized.copies} cop${realized.copies === 1 ? "y" : "ies"}`} />
            <Stat label="Fees" value={money(realized.fees)} note="what the venues kept" />
            <Stat label="Cost" value={money(realized.cost)} note="of the copies sold" />
            <Stat label="Realised" value={money(realized.gain)} note={realized.percent === null ? "no cost recorded" : `${realized.percent >= 0 ? "+" : "−"}${Math.abs(realized.percent).toFixed(1)}%`} tone={realized.gain >= 0 ? "up" : "down"} />
          </dl>
          {realized.withoutCost > 0 && (
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              {realized.withoutCost} sale{realized.withoutCost === 1 ? "" : "s"} had no recorded cost, so the realised figure understates {realized.withoutCost === 1 ? "it" : "them"}.
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {recentSales.map((s) => (
              <li key={s.id} className="card-surface flex items-center gap-3 p-2 text-sm">
                <Link href={`/items/${s.itemId}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.title}</span>
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
    </div>
  );
}

function allocationsFor(views: AllocationView[]): AllocationView[] {
  return views.filter((v) => v.rows.length > 0);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

const SERIES = ["var(--chart-series-1)", "var(--chart-series-2)", "var(--chart-series-3)", "var(--chart-series-4)", "var(--chart-series-5)"];

function SplitChart({ view }: { view: AllocationView }) {
  return (
    <section>
      <h2 className="font-display mb-3 text-lg font-semibold uppercase tracking-wide">{view.label}</h2>
      <ul className="space-y-2">
        {view.rows.map((row, i) => (
          <li key={row.key}>
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
              <div className="h-full rounded-full" style={{ width: `${Math.max(1, row.share * 100)}%`, background: row.color ?? SERIES[i % SERIES.length] }} />
            </div>
          </li>
        ))}
      </ul>
      {view.unclassified > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          {money(view.unclassified)} ({(view.unclassifiedShare * 100).toFixed(0)}%) {view.unclassifiedNote}, so these do not add up to the whole.
        </p>
      )}
    </section>
  );
}
