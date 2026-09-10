"use client";

import { useState } from "react";
import { api } from "@collectcollect/core/api-client";
import { EXTERIORS, EXTERIOR_IDS, MARKETS, MARKET_IDS, type ProviderStatus, type Settings } from "@/lib/types";

/**
 * The numbers the app does arithmetic with, and who is allowed to set them.
 *
 * Everything here is saved or nothing is: a form that reports "Saved" while
 * quietly dropping a field back to a default is worse than one that refuses,
 * because the owner has no way to tell it happened.
 */
export function SettingsForm({ initial, providers }: { initial: Settings; providers: ProviderStatus[] }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const patch = (next: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...next }));
    setStatus("idle");
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const body = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(body.settings);
      setStatus("saved");
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  };

  return (
    <form onSubmit={save} className="space-y-8">
      <section>
        <h2 className="font-display mb-1 text-lg font-semibold uppercase tracking-wide">What each market keeps</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          The fraction of a buyer&rsquo;s price you do not receive. Steam&rsquo;s
          fee is charged to the buyer, so a seller nets the price divided by
          1.15 — which is the 0.1304 below, not 0.15.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {MARKET_IDS.map((id) => (
            <div key={id}>
              <label className="label" htmlFor={`fee-${id}`}>
                {MARKETS[id].label}
              </label>
              <input
                id={`fee-${id}`}
                className="input"
                inputMode="decimal"
                value={settings.marketFees[id] ?? ""}
                onChange={(e) => patch({ marketFees: { ...settings.marketFees, [id]: numberOrNaN(e.target.value) } })}
              />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {MARKETS[id].cashOut ? "Pays out as money." : "Wallet funds only."}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display mb-1 text-lg font-semibold uppercase tracking-wide">Wear multipliers</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          A tier&rsquo;s own market price already reflects its wear, so these
          start at 1. They only apply when a copy has to be priced against a
          neighbouring tier&rsquo;s quote.
        </p>
        <div className="grid gap-3 sm:grid-cols-5">
          {EXTERIOR_IDS.map((id) => (
            <div key={id}>
              <label className="label" htmlFor={`wear-${id}`}>
                {EXTERIORS[id]}
              </label>
              <input
                id={`wear-${id}`}
                className="input"
                inputMode="decimal"
                value={settings.exteriorMultipliers[id] ?? ""}
                onChange={(e) =>
                  patch({ exteriorMultipliers: { ...settings.exteriorMultipliers, [id]: numberOrNaN(e.target.value) } })
                }
              />
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="stattrak">
              StatTrak™ premium
            </label>
            <input
              id="stattrak"
              className="input"
              inputMode="decimal"
              value={settings.stattrakMultiplier}
              onChange={(e) => patch({ stattrakMultiplier: numberOrNaN(e.target.value) })}
            />
          </div>
          <div>
            <label className="label" htmlFor="souvenir">
              Souvenir premium
            </label>
            <input
              id="souvenir"
              className="input"
              inputMode="decimal"
              value={settings.souvenirMultiplier}
              onChange={(e) => patch({ souvenirMultiplier: numberOrNaN(e.target.value) })}
            />
          </div>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Both start at 1 rather than at a plausible-looking guess: an invented
          premium would read as a measurement.
        </p>
      </section>

      <section>
        <h2 className="font-display mb-1 text-lg font-semibold uppercase tracking-wide">When to say something</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="move">
              Price move, %
            </label>
            <input
              id="move"
              className="input"
              inputMode="decimal"
              value={settings.alertMovePercent}
              onChange={(e) => patch({ alertMovePercent: numberOrNaN(e.target.value) })}
            />
          </div>
          <div>
            <label className="label" htmlFor="spread-amount">
              Spread worth acting on, $
            </label>
            <input
              id="spread-amount"
              className="input"
              inputMode="decimal"
              value={settings.spreadMinAmount}
              onChange={(e) => patch({ spreadMinAmount: numberOrNaN(e.target.value) })}
            />
          </div>
          <div>
            <label className="label" htmlFor="spread-percent">
              …and at least, %
            </label>
            <input
              id="spread-percent"
              className="input"
              inputMode="decimal"
              value={settings.spreadMinPercent}
              onChange={(e) => patch({ spreadMinPercent: numberOrNaN(e.target.value) })}
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display mb-1 text-lg font-semibold uppercase tracking-wide">You</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="owner">
              Name on the report
            </label>
            <input id="owner" className="input" value={settings.ownerName} onChange={(e) => patch({ ownerName: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="webhook">
              Send new alerts to
            </label>
            <input
              id="webhook"
              className="input"
              value={settings.alertWebhookUrl}
              onChange={(e) => patch({ alertWebhookUrl: e.target.value })}
              placeholder="https://…"
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display mb-1 text-lg font-semibold uppercase tracking-wide">Price sources</h2>
        <ul className="space-y-2 text-sm">
          {providers.map((provider) => (
            <li key={provider.id} className="card-surface flex flex-wrap items-baseline gap-x-2 p-3">
              <span className="font-medium">{provider.label}</span>
              <span
                className="badge border"
                style={{
                  borderColor: provider.configured ? "var(--chart-good)" : "var(--line-strong)",
                  color: provider.configured ? "var(--chart-good-text)" : "var(--muted)",
                }}
              >
                {provider.configured ? "In use" : "Not available"}
              </span>
              <span className="w-full text-xs" style={{ color: "var(--muted)" }}>
                {provider.note}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {error && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && (
          <span className="text-sm" style={{ color: "var(--chart-good-text)" }}>
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * An empty or unparseable box becomes NaN, which JSON sends as null and the
 * server refuses by name. Coercing it to zero here would silently rewrite a
 * fee, and the owner would never know.
 */
function numberOrNaN(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}
