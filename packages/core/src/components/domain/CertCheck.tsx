"use client";

import { useState } from "react";
import { api } from "../../api-client";
import type { CertVerification } from "../../domain/spec";

/** Ask the grading company's register whether the cert on this slab matches. */
export function CertCheck({ itemId, label, note }: { itemId: number; label: string; note: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CertVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult((await api<{ verification: CertVerification }>(`/api/items/${itemId}/verify-cert`, { method: "POST" })).verification);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tone = result?.status === "match" ? "var(--chart-good-text)" : result?.status === "mismatch" ? "var(--chart-bad-text)" : "var(--muted)";
  return (
    <section className="card-surface space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label mb-0">Certificate</span>
        <button type="button" className="btn-secondary" onClick={check} disabled={busy}>
          {busy ? "Checking…" : `Check with ${label}`}
        </button>
      </div>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {note}
      </p>
      {result && (
        <p className="text-sm" style={{ color: tone }}>
          <strong className="uppercase">{result.status}</strong> · {result.detail}
        </p>
      )}
      {error && (
        <p className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
