"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
export function ProviderTest({ id }: { id: string }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  async function test() {
    setBusy(true); setResult(null);
    try { setResult(await api("/api/providers/test", { method: "POST", body: JSON.stringify({ id }) })); }
    catch (e) { setResult({ ok: false, message: (e as Error).message }); } finally { setBusy(false); }
  }
  return <div className="mt-2"><button className="btn-secondary" disabled={busy} onClick={test}>{busy ? "Testing…" : "Test connection"}</button>{result && <p role="status" className={`mt-1 max-w-sm text-xs ${result.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>{result.message}</p>}</div>;
}
