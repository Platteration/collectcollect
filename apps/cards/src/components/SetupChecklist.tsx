"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api-client";
interface Status { dismissed: boolean; hasCards: boolean; identificationConfigured: boolean; passwordSet: boolean }
export function SetupChecklist({ status, reopen = false }: { status: Status; reopen?: boolean }) {
  const router = useRouter(), pathname = usePathname();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function toggle(dismissed: boolean) {
    setBusy(true); setError(null);
    try { await api("/api/setup", { method: "PUT", body: JSON.stringify({ dismissed }) }); router.refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (pathname === "/login") return null;
  if (status.dismissed) return reopen ? <div><button className="btn-secondary" disabled={busy} onClick={() => toggle(false)}>Reopen setup checklist</button>{error && <p role="alert">{error}</p>}</div> : null;
  if (reopen) return null;
  return <section className="card-surface mb-5 space-y-3 p-4" aria-label="Getting started">
    <div className="flex items-center justify-between gap-2"><h2 className="font-display text-xl font-semibold">Make this collection yours</h2><button className="btn-secondary" disabled={busy} onClick={() => toggle(true)}>Dismiss checklist</button></div>
    <p className="text-sm text-[var(--muted)]">Start with manual entry or a CSV. Photo identification and paid price sources are optional.</p>
    <ol className="grid gap-2 text-sm sm:grid-cols-2">
      <li>{status.hasCards ? "✓ First card added" : "1. Add your first card"} · <Link className="underline" href="/add">Add card</Link> / <Link className="underline" href="/import">Import CSV</Link></li>
      <li>{status.identificationConfigured ? "✓ Photo identification configured" : "2. Optional photo identification"} · <Link className="underline" href="/settings#data-sources">Check data sources</Link></li>
      <li>{status.passwordSet ? "✓ Password protection enabled" : "3. Local access: password not set"} · <Link className="underline" href="/settings#data-sources">Hosting setup</Link></li>
      <li>4. Keep a backup · <Link className="underline" href="/settings#backup">Download and restore</Link></li>
    </ol>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  </section>;
}
