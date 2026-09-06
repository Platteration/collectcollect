"use client";

import { money, when } from "@/lib/format";
import type { PriceSummary } from "@/lib/types";

interface Props {
  summary: PriceSummary | null;
  loading: boolean;
  onRefresh: () => void;
  title?: string;
}

export function PricePanel({ summary, loading, onRefresh, title = "Market prices" }: Props) {
  const gradedEntries = summary ? Object.entries(summary.graded) : [];
  const estimatedEntries = summary ? Object.entries(summary.estimatedGraded) : [];
  return (
    <section className="card-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={loading}>
          {loading ? "Looking up…" : summary ? "Refresh prices" : "Look up prices"}
        </button>
      </div>

      {!summary && !loading && (
        <p className="mt-3 text-sm text-neutral-500">
          Fetch the current going rate for an ungraded copy and for graded (PSA / BGS / CGC) copies.
        </p>
      )}

      {summary && (
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/40">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Your copy</div>
              <div className="text-2xl font-semibold">{money(summary.yourCopyValue)}</div>
              <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">{summary.yourCopyBasis}</div>
            </div>
            <div className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Ungraded (raw NM)</div>
              <div className="text-2xl font-semibold">{money(summary.ungraded)}</div>
              <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
                {summary.ungradedSource ?? "No USD source returned a price"}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-medium">Graded copies</h4>
              {summary.gradedSource && <span className="text-xs text-neutral-500">from {summary.gradedSource}</span>}
            </div>
            {gradedEntries.length === 0 && estimatedEntries.length === 0 ? (
              <p className="text-sm text-neutral-500">No graded prices available.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
                {gradedEntries.map(([k, v]) => (
                  <div key={k} className="rounded-md border border-black/10 px-2 py-1.5 dark:border-white/10">
                    <div className="text-xs text-neutral-500">{k}</div>
                    <div className="font-medium">{money(v)}</div>
                  </div>
                ))}
                {estimatedEntries.map(([k, v]) => (
                  <div key={k} className="rounded-md border border-dashed border-black/15 px-2 py-1.5 dark:border-white/15" title="Estimated from the ungraded price using your Settings multipliers">
                    <div className="text-xs text-neutral-500">
                      {k} <span className="badge bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">est.</span>
                    </div>
                    <div className="font-medium">{money(v)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {summary.quotes.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium">Sources</h4>
              <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
                {summary.quotes.map((q, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {q.url ? (
                          <a href={q.url} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                            {q.sourceLabel}
                          </a>
                        ) : (
                          q.sourceLabel
                        )}
                      </div>
                      <div className="truncate text-xs text-neutral-500">
                        {q.matchedName}
                        {q.matchedDetail ? ` · ${q.matchedDetail}` : ""}
                      </div>
                      {Object.keys(q.ungradedVariants).length > 0 && (
                        <div className="text-xs text-neutral-500">
                          {Object.entries(q.ungradedVariants)
                            .map(([k, v]) => `${k} ${money(v, q.currency)}`)
                            .join(" · ")}
                        </div>
                      )}
                    </div>
                    <div className="font-medium">{q.ungraded ? money(q.ungraded, q.currency) : "graded only"}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.errors.length > 0 && (
            <ul className="rounded-md bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
              {summary.errors.map((e, i) => (
                <li key={i}>
                  {e.source}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="text-xs text-neutral-500">Fetched {when(summary.fetchedAt)}</div>
        </div>
      )}
    </section>
  );
}
