"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../api-client";
import type { PriceJob } from "../price-jobs";

export function PriceRefresh({ count, detailPath, label = "Refresh all prices" }: { count: number; detailPath: string; label?: string }) {
  const router = useRouter();
  const [job, setJob] = useState<PriceJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const notified = useRef<string | null>(null);
  const current = useRef<PriceJob | null>(null);
  const generation = useRef(0);
  const pendingStart = useRef(false);
  const accept = useCallback((next: PriceJob | null) => {
    const previous = current.current;
    current.current = next;
    setJob(next);
    setError(null);
    if (next && next.status !== "running" && previous?.id === next.id && previous.status === "running" && notified.current !== next.id) {
      notified.current = next.id;
      router.refresh();
    }
  }, [router]);
  const running = job?.status === "running";
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function read() {
      const requestedGeneration = generation.current;
      try {
        if (!pendingStart.current) {
          const response = await api<{ job: PriceJob | null }>("/api/price-jobs", { signal: controller.signal, cache: "no-store" });
          if (!disposed && !pendingStart.current && requestedGeneration === generation.current) accept(response.job);
        }
      } catch (error) {
        if (!disposed && !pendingStart.current && requestedGeneration === generation.current) setError(error instanceof Error ? error.message : "Could not read refresh progress.");
      } finally {
        if (!disposed) timer = setTimeout(() => { void read(); }, pendingStart.current ? 250 : running ? 2000 : 15_000);
      }
    }
    void read();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [accept, running]);
  async function start(retry = false) {
    if (pendingStart.current) return;
    pendingStart.current = true;
    generation.current++;
    setStarting(true); setError(null);
    try { const r = await api<{ job: PriceJob }>("/api/price-jobs", { method: "POST", body: JSON.stringify(retry && job ? { retryJobId: job.id } : {}) }); accept(r.job); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start refresh."); }
    finally { pendingStart.current = false; setStarting(false); }
  }
  const busy = starting || job?.status === "running";
  const issues = job?.outcomes.filter(o => o.status === "failed" || o.status === "unpriced") ?? [];
  const priced = job?.outcomes.filter(o => o.status === "priced").length ?? 0;
  return <div className="max-w-xl space-y-2 text-sm">
    <button type="button" className="btn-secondary" onClick={() => void start()} disabled={busy || count === 0}>{busy ? "Refreshing…" : label}</button>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    {job && <div role="status" className="text-xs text-[var(--muted)]">
      {job.status === "running" ? `${job.outcomes.length} of ${job.total} checked. You can leave this page.` : `${priced} priced; ${issues.length} need attention.`}
      {job.error && <p>{job.error}</p>}
    </div>}
    {!busy && job && (issues.length > 0 || job.status === "interrupted") && <button type="button" className="btn-secondary" onClick={() => void start(true)}>Retry unfinished prices</button>}
    {job && issues.length > 0 && <details className="text-xs"><summary>Price refresh details ({issues.length})</summary><ul className="mt-2 space-y-2">
      {issues.map(o => <li key={o.id}><a href={`${detailPath}/${o.id}`} className="underline">Item #{o.id}</a>: {o.message ?? o.status}</li>)}
    </ul></details>}
  </div>;
}
