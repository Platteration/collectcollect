"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import type { RefreshResult } from "@/lib/pricing/refresh";

/**
 * Price the whole inventory.
 *
 * Slow on purpose for anything large: Steam answers about twenty times a
 * minute, and the alternative to waiting is dropping items, which would make
 * the totals quietly wrong. The button says so rather than looking broken.
 */
export function RefreshPrices({ items }: { items: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = await api<{ result: RefreshResult }>("/api/prices/refresh", { method: "POST" });
      setResult(body.result);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={run} disabled={busy || items === 0}>
          {busy ? "Asking the markets…" : "Refresh every price"}
        </button>
        {items > 20 && (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {items} items. Steam answers about twenty times a minute, so this
            takes a few minutes.
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}

      {result && (
        <div className="card-surface space-y-1 p-3 text-sm">
          <p>
            {result.refreshed} priced
            {result.unpriced > 0 && `, ${result.unpriced} nothing is listing`}
            {result.skipped > 0 && `, ${result.skipped} already recent`}.
          </p>
          {result.providerErrors.map((e) => (
            <p key={e.source} style={{ color: "var(--chart-bad-text)" }}>
              {e.source}: {e.message}
            </p>
          ))}
          {result.failed.length > 0 && (
            <p style={{ color: "var(--chart-bad-text)" }}>{result.failed.length} could not be priced at all.</p>
          )}
        </div>
      )}
    </div>
  );
}
