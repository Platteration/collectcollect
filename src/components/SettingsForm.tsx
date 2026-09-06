"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { CONDITIONS, type Condition, type Settings } from "@/lib/types";

export function SettingsForm({ initial }: { initial: Settings }) {
  const [grades, setGrades] = useState<Array<[string, string]>>(Object.entries(initial.gradeMultipliers).map(([k, v]) => [k, String(v)]));
  const [conditions, setConditions] = useState<Record<Condition, string>>(
    Object.fromEntries(Object.entries(initial.conditionMultipliers).map(([k, v]) => [k, String(v)])) as Record<Condition, string>,
  );
  const [gradingFee, setGradingFee] = useState(String(initial.gradingFee));
  const [readyMinUpside, setReadyMinUpside] = useState(String(initial.readyMinUpside));
  const [readyMinUpsidePercent, setReadyMinUpsidePercent] = useState(String(initial.readyMinUpsidePercent));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const gradeMultipliers: Record<string, number> = {};
      for (const [k, v] of grades) if (k.trim() && v.trim() !== "") gradeMultipliers[k.trim()] = Number(v);
      const conditionMultipliers = Object.fromEntries(Object.entries(conditions).map(([k, v]) => [k, Number(v)])) as Settings["conditionMultipliers"];
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ gradeMultipliers, conditionMultipliers, gradingFee: Number(gradingFee), readyMinUpside: Number(readyMinUpside), readyMinUpsidePercent: Number(readyMinUpsidePercent) }) });
      setStatus("Saved. New multipliers apply the next time a card's prices are refreshed.");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card-surface p-4">
        <h2 className="font-semibold">Graded price estimates</h2>
        <p className="mt-1 text-sm text-neutral-500">
          When no source reports a real graded price, CollectCollect estimates one as <em>ungraded price × multiplier</em>. These
          ratios vary enormously by card (a modern common in PSA 10 may be 2×, a vintage holo 10× or more), so treat them as
          rough starting points and adjust to what you see on recent sales.
        </p>
        <div className="mt-3 space-y-2">
          {grades.map(([k, v], i) => (
            <div key={i} className="flex gap-2">
              <input className="input max-w-[12rem]" value={k} onChange={(e) => setGrades((g) => g.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))} placeholder="PSA 10" />
              <input className="input max-w-[8rem]" value={v} onChange={(e) => setGrades((g) => g.map((row, j) => (j === i ? [row[0], e.target.value] : row)))} inputMode="decimal" />
              <button type="button" className="btn-secondary" onClick={() => setGrades((g) => g.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={() => setGrades((g) => [...g, ["", ""]])}>
            + Add grade
          </button>
        </div>
      </section>

      <section className="card-surface p-4">
        <h2 className="font-semibold">Raw condition adjustments</h2>
        <p className="mt-1 text-sm text-neutral-500">Market prices are for Near Mint copies. Played copies are valued at ungraded price × multiplier.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(Object.keys(CONDITIONS) as Condition[]).map((c) => (
            <div key={c}>
              <label className="label">
                {c} · {CONDITIONS[c]}
              </label>
              <input className="input" value={conditions[c]} onChange={(e) => setConditions((s) => ({ ...s, [c]: e.target.value }))} inputMode="decimal" />
            </div>
          ))}
        </div>
      </section>

      <section className="card-surface p-4">
        <h2 className="font-semibold">Grading cost</h2>
        <p className="mt-1 text-sm text-neutral-500">Per-card cost to grade (submission fee plus shipping). The grading outlook subtracts it from the graded outcomes.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Fee per card (USD)</label>
            <input className="input" value={gradingFee} onChange={(e) => setGradingFee(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <label className="label">Ready when upside ≥ (USD)</label>
            <input className="input" value={readyMinUpside} onChange={(e) => setReadyMinUpside(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <label className="label">and upside ≥ (% of raw)</label>
            <input className="input" value={readyMinUpsidePercent} onChange={(e) => setReadyMinUpsidePercent(e.target.value)} inputMode="decimal" />
          </div>
        </div>
        <p className="mt-2 text-xs text-neutral-500">A raw card is flagged “Ready” when the timing looks right and its upside after the fee clears both thresholds.</p>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {status && <span className="text-sm text-neutral-600 dark:text-neutral-300">{status}</span>}
      </div>
    </div>
  );
}
