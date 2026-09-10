"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../api-client";
import type { RefreshResult } from "../../domain/pricing/refresh";

export function RefreshPrices({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult((await api<{ result: RefreshResult }>("/api/prices/refresh", { method: "POST" })).result);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-secondary" onClick={run} disabled={busy || count === 0}>
        {busy ? "Asking the sources…" : "Refresh every price"}
      </button>
      {result && (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {result.refreshed} priced{result.unpriced > 0 && `, ${result.unpriced} returned nothing`}
          {result.skipped > 0 && `, ${result.skipped} already recent`}
          {result.failed.length > 0 && `, ${result.failed.length} failed`}.
        </span>
      )}
      {error && (
        <span className="text-xs" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
