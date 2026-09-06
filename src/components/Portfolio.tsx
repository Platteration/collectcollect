"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { RANGES, change, sliceRange, type Allocation, type OutlookPoint, type PortfolioPoint, type Range, type Returns, type Verdict } from "@/lib/analytics";
import { money, when } from "@/lib/format";
import { GAMES, type Game } from "@/lib/types";
import { PortfolioChart } from "./charts/PortfolioChart";
import { OutlookChart } from "./charts/OutlookChart";
import { VERDICT_STYLE } from "./verdict";

export interface Opportunity {
  id: number;
  name: string;
  game: Game;
  detail: string;
  image: string | null;
  quantity: number;
  series: OutlookPoint[];
  verdict: Verdict;
}

export interface Holding {
  id: number;
  name: string;
  detail: string;
  image: string | null;
  copy: string;
  value: number;
}

interface Props {
  points: PortfolioPoint[];
  cardCount: number;
  copyCount: number;
  pricedCount: number;
  lastRefreshed: string | null;
  opportunities: Opportunity[];
  holdings: Holding[];
  returns: Returns;
  allocation: Allocation[];
}

const GAME_COLORS: Record<Game, string> = {
  pokemon: "var(--chart-series-1)",
  yugioh: "var(--chart-series-2)",
  mtg: "var(--chart-series-3)",
  sports: "var(--chart-series-4)",
  other: "var(--chart-series-5)",
};

export function Portfolio({ points, cardCount, copyCount, pricedCount, lastRefreshed, opportunities, holdings, returns, allocation }: Props) {
  const router = useRouter();
  const [range, setRange] = useState<Range>("1M");
  const [hover, setHover] = useState<PortfolioPoint | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const visible = useMemo(() => sliceRange(points, range), [points, range]);
  const latest = points[points.length - 1] ?? null;
  const shown = hover ?? latest;
  const delta = useMemo(() => {
    if (!hover) return change(visible);
    const first = visible[0];
    return first ? change([first, hover]) : change([]);
  }, [visible, hover]);
  const up = delta.amount >= 0;

  const refreshAll = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const r = await api<{ refreshed: number; unpriced: number; failed: Array<{ cardId: number; message: string }> }>("/api/prices/refresh", { method: "POST" });
      const parts = [`Refreshed ${r.refreshed} card${r.refreshed === 1 ? "" : "s"}`];
      if (r.unpriced) parts.push(`${r.unpriced} returned no prices (previous values kept)`);
      if (r.failed.length) parts.push(`${r.failed.length} failed`);
      setMessage(parts.join(", ") + ".");
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  if (cardCount === 0) {
    return (
      <div className="card-surface flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-lg font-medium">Your portfolio is empty</p>
        <p className="max-w-md text-sm text-neutral-500">
          Add a few cards and this page becomes a live view of what your collection is worth, how that value moves, and which raw cards are worth sending in for grading.
        </p>
        <Link href="/add" className="btn-primary">
          Add your first card
        </Link>
      </div>
    );
  }

  const returnsUp = returns.amount >= 0;

  return (
    <div className="space-y-8">
      <section className="card-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-neutral-500">Collection value</div>
            <div className="text-5xl font-semibold tracking-tight">{money(shown?.value ?? 0)}</div>
            <div className={`mt-1 flex flex-wrap items-center gap-x-3 text-sm ${up ? "delta-up" : "delta-down"}`}>
              <span className="font-medium">
                {up ? "▲" : "▼"} {money(Math.abs(delta.amount))}
                {delta.percent !== null ? ` (${Math.abs(delta.percent).toFixed(2)}%)` : ""}
              </span>
              <span className="text-neutral-500">
                {hover ? `on ${when(hover.t)}` : delta.from ? `since ${when(delta.from)}` : "no earlier snapshot to compare"}
              </span>
            </div>
            {returns.cardsWithCost > 0 && (
              <div className="mt-1 text-sm">
                <span className="text-neutral-500">Total return </span>
                <span className={`font-medium ${returnsUp ? "delta-up" : "delta-down"}`}>
                  {returnsUp ? "▲" : "▼"} {money(Math.abs(returns.amount))}
                  {returns.percent !== null ? ` (${Math.abs(returns.percent).toFixed(2)}%)` : ""}
                </span>
                <span className="text-neutral-500">
                  {" "}
                  on {money(returns.invested)} paid for {returns.cardsWithCost} of {cardCount} cards
                </span>
              </div>
            )}
            <p className="mt-2 max-w-xl text-xs text-neutral-500">
              Based on the grade or condition you recorded for each copy: {pricedCount} of {cardCount} cards priced, {copyCount} copies in total. Raw NM value of everything: {money(shown?.ungraded ?? 0)}.
              {returns.cardsWithCost === 0 ? " Record purchase prices to see your total return." : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button type="button" className="btn-secondary" onClick={refreshAll} disabled={refreshing || cardCount === 0}>
              {refreshing ? "Refreshing…" : "Refresh all prices"}
            </button>
            <span className="text-xs text-neutral-500">{message ?? (lastRefreshed ? `Last refresh ${when(lastRefreshed)}` : "Never refreshed")}</span>
          </div>
        </div>

        <div className="mt-4">
          <PortfolioChart points={visible} up={up} onHover={setHover} />
        </div>
        <div className="mt-3 flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${range === r ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold">Grading outlook</h2>
            <p className="text-sm text-neutral-500">
              Your ungraded cards. The band is the range of outcomes if you graded today (mid grade to gem mint); the line is the raw value. The wider the band above the line, the more grading could add.
            </p>
          </div>
        </div>
        {opportunities.length === 0 ? (
          <div className="card-surface p-6 text-sm text-neutral-500">No ungraded cards with prices yet.</div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {opportunities.map((o) => {
              const last = o.series[o.series.length - 1];
              return (
                <li key={o.id} className="card-surface p-3">
                  <div className="flex gap-3">
                    <Link href={`/cards/${o.id}`} className="h-20 w-14 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                      {o.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : null}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/cards/${o.id}`} className="truncate font-medium hover:underline">
                          {o.name}
                          {o.quantity > 1 ? ` ×${o.quantity}` : ""}
                        </Link>
                        <span className={`badge ${VERDICT_STYLE[o.verdict.kind]}`}>{o.verdict.headline}</span>
                      </div>
                      <div className="truncate text-xs text-neutral-500">
                        {GAMES[o.game]} · {o.detail}
                      </div>
                      {last && (
                        <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                          <Stat label="Raw now" value={money(last.raw)} />
                          <Stat label={`${last.minLabel} → ${last.maxLabel}`} value={`${money(last.min)} – ${money(last.max)}`} />
                          <Stat label="Upside after fee" value={money(last.upside)} tone={last.upside > 0 ? "up" : "down"} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2">
                    <OutlookChart series={o.series} compact />
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{o.verdict.detail}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {allocation.length > 1 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">By game</h2>
          <div className="card-surface p-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" role="img" aria-label="Share of collection value by game">
              {allocation.map((a) => (
                <div key={a.game} style={{ width: `${a.share * 100}%`, background: GAME_COLORS[a.game], marginRight: 2 }} title={`${GAMES[a.game]} ${(a.share * 100).toFixed(0)}%`} />
              ))}
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {allocation.map((a) => (
                <li key={a.game} className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: GAME_COLORS[a.game] }} />
                  <span className="min-w-0 flex-1 truncate">
                    {GAMES[a.game]} <span className="text-neutral-500">· {a.cards}</span>
                  </span>
                  <span className="font-medium">{money(a.value)}</span>
                  <span className="w-10 text-right text-neutral-500">{(a.share * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {holdings.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-lg font-semibold">Top holdings</h2>
            <Link href="/collection" className="text-sm underline decoration-dotted">
              View all {cardCount} cards
            </Link>
          </div>
          <ul className="card-surface divide-y divide-black/5 dark:divide-white/5">
            {holdings.map((h) => (
              <li key={h.id}>
                <Link href={`/cards/${h.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-black/[0.03] dark:hover:bg-white/5">
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                    {h.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{h.name}</div>
                    <div className="truncate text-xs text-neutral-500">
                      {h.detail} · {h.copy}
                    </div>
                  </div>
                  <div className="font-semibold">{money(h.value)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase leading-tight tracking-wide text-neutral-500">{label}</div>
      <div className={`truncate font-medium ${tone === "up" ? "delta-up" : tone === "down" ? "delta-down" : ""}`}>{value}</div>
    </div>
  );
}
