"use client";

import { useState } from "react";
import { api } from "../../api-client";
import type { ProviderStatus, SettingFieldSpec } from "../../domain/spec";

/**
 * The numbers the app does arithmetic with, drawn from the settings spec.
 * Everything here is saved or nothing is: a form that reports "Saved" while
 * quietly dropping a field back to a default is worse than one that refuses.
 */
export function SettingsForm({ fields, initial, providers }: { fields: SettingFieldSpec[]; initial: Record<string, unknown>; providers: ProviderStatus[] }) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, v: unknown) => {
    setValues((s) => ({ ...s, [key]: v }));
    setStatus("idle");
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const body = await api<{ settings: Record<string, unknown> }>("/api/settings", { method: "PUT", body: JSON.stringify(values) });
      setValues(body.settings);
      setStatus("saved");
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  };

  const sections = new Map<string, SettingFieldSpec[]>();
  for (const f of fields) sections.set(f.section ?? "Settings", [...(sections.get(f.section ?? "Settings") ?? []), f]);

  return (
    <form onSubmit={save} className="space-y-8">
      {[...sections.entries()].map(([section, list]) => (
        <section key={section} className="card-surface space-y-3 p-4">
          <h2 className="font-semibold">{section}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((f) => (
              <Setting key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        </section>
      ))}

      <section className="card-surface p-4">
        <h2 className="font-semibold">Data sources</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Configured through environment variables (see <code>.env.example</code>). Restart the server after changing them.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{p.label}</span>
              <span className="badge border" style={{ borderColor: p.configured ? "var(--chart-good)" : "var(--line-strong)", color: p.configured ? "var(--chart-good-text)" : "var(--muted)" }}>
                {p.configured ? "Ready" : p.optional ? "Not configured" : "Missing"}
              </span>
              <span className="w-full text-xs" style={{ color: "var(--muted)" }}>
                {p.note}
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
          {status === "saving" ? "Saving…" : "Save settings"}
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

/** An empty or unparseable box becomes NaN, which JSON sends as null and the server refuses by name. */
function numberOrNaN(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

function Setting({ field, value, onChange }: { field: SettingFieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const help = field.help ? (
    <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
      {field.help}
    </p>
  ) : null;
  switch (field.type) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 pt-5 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>{field.label}</span>
          {field.help && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {field.help}
            </span>
          )}
        </label>
      );
    case "numbers": {
      const entries = Object.entries((value ?? {}) as Record<string, number>);
      return (
        <div className="sm:col-span-2">
          <span className="label">{field.label}</span>
          <div className="space-y-2">
            {entries.map(([k, v], i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input max-w-[14rem]"
                  value={k}
                  readOnly={!field.editableKeys}
                  onChange={(e) => {
                    const next = Object.fromEntries(entries.map(([kk, vv], j) => (j === i ? [e.target.value, vv] : [kk, vv])));
                    onChange(next);
                  }}
                />
                <input className="input max-w-[8rem]" inputMode="decimal" value={Number.isNaN(v) ? "" : String(v)} onChange={(e) => onChange({ ...(value as Record<string, number>), [k]: numberOrNaN(e.target.value) })} />
                {field.editableKeys && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const next = { ...(value as Record<string, number>) };
                      delete next[k];
                      onChange(next);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {field.editableKeys && (
              <button type="button" className="btn-secondary" onClick={() => onChange({ ...(value as Record<string, number>), "": Number.NaN })}>
                + Add
              </button>
            )}
          </div>
          {help}
        </div>
      );
    }
    case "number":
      return (
        <label className="block">
          <span className="label">{field.label}</span>
          <input className="input" inputMode="decimal" value={value === undefined || value === null || Number.isNaN(value as number) ? "" : String(value)} onChange={(e) => onChange(numberOrNaN(e.target.value))} />
          {help}
        </label>
      );
    default:
      return (
        <label className="block">
          <span className="label">{field.label}</span>
          <input className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
          {help}
        </label>
      );
  }
}
