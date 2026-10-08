"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { GRADING_COMPANIES, type Submission } from "@/lib/types";

export function NewSubmission({ defaultFee }: { defaultFee: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", company: "PSA", serviceLevel: "", feePerCard: String(defaultFee), shipping: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { submission } = await api<{ submission: Submission }>("/api/submissions", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          company: form.company,
          serviceLevel: form.serviceLevel,
          feePerCard: Number(form.feePerCard || 0),
          shipping: Number(form.shipping || 0),
        }),
      });
      router.push(`/submissions/${submission.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        New submission
      </button>
    );
  }

  return (
    <div className="card-surface w-full max-w-xl p-4">
      <h2 className="font-semibold">New submission</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Company</span>
          <select className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            {GRADING_COMPANIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Service level</span>
          <input className="input" value={form.serviceLevel} onChange={(e) => setForm({ ...form, serviceLevel: e.target.value })} placeholder="Value, Express…" />
        </label>
        <label className="block">
          <span className="label">Fee per card</span>
          <input className="input" value={form.feePerCard} onChange={(e) => setForm({ ...form, feePerCard: e.target.value })} inputMode="decimal" />
        </label>
        <label className="block">
          <span className="label">Shipping total</span>
          <input className="input" value={form.shipping} onChange={(e) => setForm({ ...form, shipping: e.target.value })} inputMode="decimal" />
        </label>
        <label className="col-span-2 block">
          <span className="label">Name</span>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`${form.company} submission`} />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-primary" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
