"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { CONDITIONS, type Condition, type Settings } from "@/lib/types";

/**
 * The numbers the app does arithmetic with, and who is allowed to set them.
 *
 * Everything here is saved or nothing is: a form that reports "Saved" while
 * quietly dropping a field back to a default is worse than one that refuses,
 * because the owner has no way to tell it happened. So a refusal is shown as
 * one, and what the server actually stored is read back into the boxes.
 */
export function SettingsForm({ initial }: { initial: Settings }) {
  const [grades, setGrades] = useState<Array<[string, string]>>(gradeRows(initial));
  const [conditions, setConditions] = useState<Record<Condition, string>>(conditionRows(initial));
  const [gradingFee, setGradingFee] = useState(String(initial.gradingFee));
  const [readyMinUpside, setReadyMinUpside] = useState(String(initial.readyMinUpside));
  const [readyMinUpsidePercent, setReadyMinUpsidePercent] = useState(String(initial.readyMinUpsidePercent));
  const [ownerName, setOwnerName] = useState(initial.ownerName);
  const [alertMovePercent, setAlertMovePercent] = useState(String(initial.alertMovePercent));
  const [alertWebhookUrl, setAlertWebhookUrl] = useState(initial.alertWebhookUrl);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setStatus("saving");
    setError(null);
    try {
      const gradeMultipliers: Record<string, number> = {};
      for (const [k, v] of grades) if (k.trim() && v.trim() !== "") gradeMultipliers[k.trim()] = numberOrNaN(v);
      const conditionMultipliers = Object.fromEntries(
        Object.entries(conditions).map(([k, v]) => [k, numberOrNaN(v)]),
      ) as Settings["conditionMultipliers"];
      const body = await api<{ settings: Settings }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          gradeMultipliers,
          conditionMultipliers,
          gradingFee: numberOrNaN(gradingFee),
          readyMinUpside: numberOrNaN(readyMinUpside),
          readyMinUpsidePercent: numberOrNaN(readyMinUpsidePercent),
          ownerName,
          alertMovePercent: numberOrNaN(alertMovePercent),
          alertWebhookUrl,
        }),
      });
      // What was stored, not what was typed: the server trims and normalises.
      const saved = body.settings;
      setGrades(gradeRows(saved));
      setConditions(conditionRows(saved));
      setGradingFee(String(saved.gradingFee));
      setReadyMinUpside(String(saved.readyMinUpside));
      setReadyMinUpsidePercent(String(saved.readyMinUpsidePercent));
      setOwnerName(saved.ownerName);
      setAlertMovePercent(String(saved.alertMovePercent));
      setAlertWebhookUrl(saved.alertWebhookUrl);
      setStatus("saved");
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
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
              <input
                className="input max-w-[12rem]"
                value={k}
                aria-label={`Grade ${i + 1}`}
                onChange={(e) => setGrades((g) => g.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))}
                placeholder="PSA 10"
              />
              <input
                className="input max-w-[8rem]"
                value={v}
                aria-label={`Multiplier for ${k.trim() || `grade ${i + 1}`}`}
                onChange={(e) => setGrades((g) => g.map((row, j) => (j === i ? [row[0], e.target.value] : row)))}
                inputMode="decimal"
              />
              <button
                type="button"
                className="btn-secondary"
                aria-label={`Remove ${k.trim() || `grade ${i + 1}`}`}
                onClick={() => setGrades((g) => g.filter((_, j) => j !== i))}
              >
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
            <label className="block" key={c}>
              <span className="label">
                {c} · {CONDITIONS[c]}
              </span>
              <input className="input" value={conditions[c]} onChange={(e) => setConditions((s) => ({ ...s, [c]: e.target.value }))} inputMode="decimal" />
            </label>
          ))}
        </div>
      </section>

      <section className="card-surface p-4">
        <h2 className="font-semibold">Grading cost</h2>
        <p className="mt-1 text-sm text-neutral-500">Per-card cost to grade (submission fee plus shipping). The grading outlook subtracts it from the graded outcomes.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Fee per card (USD)</span>
            <input className="input" value={gradingFee} onChange={(e) => setGradingFee(e.target.value)} inputMode="decimal" />
          </label>
          <label className="block">
            <span className="label">Ready when upside ≥ (USD)</span>
            <input className="input" value={readyMinUpside} onChange={(e) => setReadyMinUpside(e.target.value)} inputMode="decimal" />
          </label>
          <label className="block">
            <span className="label">and upside ≥ (% of raw)</span>
            <input className="input" value={readyMinUpsidePercent} onChange={(e) => setReadyMinUpsidePercent(e.target.value)} inputMode="decimal" />
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-500">A raw card is flagged “Ready” when the timing looks right and its upside after the fee clears both thresholds.</p>
      </section>

      <section className="card-surface p-4">
        <h2 className="font-semibold">Alerts</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Raised when prices refresh. The webhook is optional: every alert is POSTed to it as JSON, so you can forward
          them to email, push or chat through a service you control.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Alert on moves of at least (%)</span>
            <input className="input" value={alertMovePercent} onChange={(e) => setAlertMovePercent(e.target.value)} inputMode="decimal" />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">Webhook URL (optional)</span>
            <input
              className="input"
              type="url"
              inputMode="url"
              value={alertWebhookUrl}
              onChange={(e) => setAlertWebhookUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
        </div>
      </section>

      <section className="card-surface p-4">
        <h2 className="font-semibold">Appraisal report</h2>
        <p className="mt-1 text-sm text-neutral-500">
          The name that appears on the printable valuation report, for insurance or your own records.
        </p>
        <label className="mt-3 block max-w-sm">
          <span className="label">Collection owner</span>
          <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Your name" />
        </label>
      </section>

      {error && (
        <p className="card-surface p-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save settings"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-green-800 dark:text-green-300">Saved. New multipliers apply the next time a card&rsquo;s prices are refreshed.</span>
        )}
      </div>
    </div>
  );
}

function gradeRows(settings: Settings): Array<[string, string]> {
  return Object.entries(settings.gradeMultipliers).map(([k, v]) => [k, String(v)]);
}

function conditionRows(settings: Settings): Record<Condition, string> {
  return Object.fromEntries(Object.entries(settings.conditionMultipliers).map(([k, v]) => [k, String(v)])) as Record<Condition, string>;
}

/**
 * An empty or unparseable box becomes NaN, which JSON sends as null and the
 * server refuses by name. Coercing it to zero here would silently rewrite a
 * fee, and the owner would never know.
 */
function numberOrNaN(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}
