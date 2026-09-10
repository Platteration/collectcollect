"use client";

import { useEffect, useState } from "react";
import { api } from "../../api-client";
import { conditionHolds, type FieldSpec } from "../../domain/spec";

/**
 * A form drawn from the spec. Every input is a string on the way through;
 * `formToInput` turns the strings back into what the engine expects, and the
 * server has the final say on what is valid.
 */
export type FormState = Record<string, string>;

export interface ItemFormValue {
  fields: FormState;
  quantity: string;
  purchasePrice: string;
  location: string;
  notes: string;
}

export function emptyForm(fields: FieldSpec[]): ItemFormValue {
  const out: FormState = {};
  for (const f of fields) out[f.key] = f.default === undefined || f.default === null ? "" : formValue(f, f.default);
  return { fields: out, quantity: "1", purchasePrice: "", location: "", notes: "" };
}

export function formValue(field: FieldSpec, value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (field.type) {
    case "boolean":
      return value ? "true" : "";
    case "list":
      return Array.isArray(value) ? value.join("\n") : String(value);
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    case "date":
      return String(value).slice(0, 10);
    default:
      return String(value);
  }
}

export function formFromItem(fields: FieldSpec[], item: Record<string, unknown> & { quantity: number; purchasePrice: number | null; location: string | null; notes: string | null }): ItemFormValue {
  const out: FormState = {};
  for (const f of fields) out[f.key] = formValue(f, item[f.key]);
  return {
    fields: out,
    quantity: String(item.quantity),
    purchasePrice: item.purchasePrice === null ? "" : String(item.purchasePrice),
    location: item.location ?? "",
    notes: item.notes ?? "",
  };
}

/** Fill a form from a partial input (an identification, a row), keeping what is already there when the input is silent. */
export function fillForm(fields: FieldSpec[], form: ItemFormValue, input: Record<string, unknown>): ItemFormValue {
  const next = { ...form, fields: { ...form.fields } };
  for (const f of fields) {
    const v = input[f.key];
    if (v !== undefined && v !== null && v !== "") next.fields[f.key] = formValue(f, v);
  }
  if (typeof input.notes === "string" && input.notes.trim() && !form.notes.trim()) next.notes = input.notes;
  return next;
}

export function formToInput(fields: FieldSpec[], form: ItemFormValue): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = form.fields[f.key] ?? "";
    switch (f.type) {
      case "boolean":
        out[f.key] = raw === "true";
        break;
      case "list":
        out[f.key] = raw.split(/\n/).map((s) => s.trim()).filter(Boolean);
        break;
      case "json":
        if (!raw.trim()) out[f.key] = null;
        else {
          try {
            out[f.key] = JSON.parse(raw);
          } catch {
            throw new Error(`${f.label} is not valid JSON`);
          }
        }
        break;
      default:
        out[f.key] = raw.trim() === "" ? null : raw.trim();
    }
  }
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  out.quantity = n(form.quantity) ?? 1;
  out.purchasePrice = n(form.purchasePrice);
  out.location = form.location.trim() || null;
  out.notes = form.notes.trim() || null;
  return out;
}

interface Props {
  fields: FieldSpec[];
  value: ItemFormValue;
  onChange: (next: ItemFormValue) => void;
  disabled?: boolean;
  /** Places already in use, offered as you type. */
  locations?: string[];
  /** Hide the quantity input, for a thing that is always one object. */
  unique?: boolean;
  /** Prefix for input ids, so two forms on one page do not collide. */
  idPrefix?: string;
}

export function ItemForm({ fields, value, onChange, disabled, locations, unique, idPrefix = "f" }: Props) {
  const [known, setKnown] = useState<string[]>(locations ?? []);
  useEffect(() => {
    if (locations) return;
    let cancelled = false;
    void api<{ locations: Array<{ location: string }> }>("/api/locations")
      .then((res) => {
        if (!cancelled) setKnown(res.locations.map((l) => l.location));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locations]);

  const setField = (key: string, v: string) => onChange({ ...value, fields: { ...value.fields, [key]: v } });
  const current: Record<string, unknown> = {};
  for (const f of fields) current[f.key] = f.type === "boolean" ? value.fields[f.key] === "true" : value.fields[f.key];

  const sections = new Map<string, FieldSpec[]>();
  for (const f of fields) {
    if (!conditionHolds(f.showWhen, current)) continue;
    const key = f.section ?? "";
    sections.set(key, [...(sections.get(key) ?? []), f]);
  }

  return (
    <fieldset disabled={disabled} className="space-y-4">
      {[...sections.entries()].map(([section, list]) => (
        <div key={section || "_"} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {section && <div className="mt-1 border-t pt-3 text-sm font-medium sm:col-span-2" style={{ borderColor: "var(--line)" }}>{section}</div>}
          {list.map((f) => (
            <Field key={f.key} field={f} value={value.fields[f.key] ?? ""} onChange={(v) => setField(f.key, v)} id={`${idPrefix}-${f.key}`} />
          ))}
        </div>
      ))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="mt-1 border-t pt-3 text-sm font-medium sm:col-span-2" style={{ borderColor: "var(--line)" }}>
          Your copy
        </div>
        {!unique && (
          <label className="block">
            <span className="label">Quantity</span>
            <input id={`${idPrefix}-quantity`} className="input" value={value.quantity} onChange={(e) => onChange({ ...value, quantity: e.target.value })} inputMode="numeric" />
          </label>
        )}
        <label className="block">
          <span className="label">Paid, each (USD)</span>
          <input
            id={`${idPrefix}-purchase-price`}
            className="input"
            value={value.purchasePrice}
            onChange={(e) => onChange({ ...value, purchasePrice: e.target.value })}
            inputMode="decimal"
            placeholder="leave blank if unknown"
          />
        </label>
        <label className="block">
          <span className="label">Kept in</span>
          <input id={`${idPrefix}-location`} className="input" value={value.location} onChange={(e) => onChange({ ...value, location: e.target.value })} list={`${idPrefix}-locations`} placeholder="Shelf 2, box A" />
          {known.length > 0 && (
            <datalist id={`${idPrefix}-locations`}>
              {known.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          )}
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Notes</span>
          <textarea id={`${idPrefix}-notes`} className="input" rows={2} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
        </label>
      </div>
    </fieldset>
  );
}

function Field({ field, value, onChange, id }: { field: FieldSpec; value: string; onChange: (v: string) => void; id: string }) {
  const wide = field.wide || field.multiline || field.type === "json" || field.type === "list";
  const help = field.help ? (
    <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
      {field.help}
    </p>
  ) : null;
  const label = (
    <span className="label">
      {field.label}
      {field.required ? " *" : ""}
      {field.private ? <span className="ml-1 normal-case tracking-normal" style={{ color: "var(--muted)" }}>(private)</span> : null}
    </span>
  );
  const cls = wide ? "block sm:col-span-2" : "block";
  switch (field.type) {
    case "boolean":
      return (
        <label className={`${cls} flex items-center gap-2 pt-5`}>
          <input id={id} type="checkbox" className="h-4 w-4" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "")} />
          <span className="text-sm">{field.label}</span>
          {field.help && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {field.help}
            </span>
          )}
        </label>
      );
    case "enum":
      return (
        <label className={cls}>
          {label}
          <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{field.required ? "Choose…" : "Not recorded"}</option>
            {Object.entries(field.options ?? {}).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {help}
        </label>
      );
    case "list":
      return (
        <label className={cls}>
          {label}
          <textarea id={id} className="input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? "One per line"} />
          {help}
        </label>
      );
    case "json":
      return (
        <label className={cls}>
          {label}
          <textarea id={id} className="input font-mono text-xs" rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
          {help}
        </label>
      );
    case "date":
      return (
        <label className={cls}>
          {label}
          <input id={id} className="input" type="date" value={value} onChange={(e) => onChange(e.target.value)} />
          {help}
        </label>
      );
    case "number":
    case "integer":
      return (
        <label className={cls}>
          {label}
          <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} inputMode={field.type === "integer" ? "numeric" : "decimal"} placeholder={field.placeholder} />
          {help}
        </label>
      );
    default:
      return field.multiline ? (
        <label className={cls}>
          {label}
          <textarea id={id} className="input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
          {help}
        </label>
      ) : (
        <label className={cls}>
          {label}
          <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
          {help}
        </label>
      );
  }
}
