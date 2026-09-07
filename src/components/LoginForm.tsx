"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";

/**
 * Resolve ?next= against this origin and refuse anything that leaves it, so a
 * crafted link cannot turn the login into an open redirect. Checking the
 * resolved origin also catches forms browsers treat as protocol-relative,
 * such as a leading "/\".
 */
export function safeNext(next: string, origin = window.location.origin): string {
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? url.pathname + url.search : "/";
  } catch {
    return "/";
  }
}

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth", { method: "POST", body: JSON.stringify({ password }) });
      // A full navigation rather than a client-side one, so the request that
      // renders the destination carries the session cookie and no cached
      // router entry from before signing in is reused.
      window.location.assign(safeNext(next));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <form onSubmit={submit} className="card-surface space-y-3 p-6">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Sign in</h1>
        <p className="text-sm text-neutral-500">This collection is password protected.</p>
        <label className="block">
          <span className="label">Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </label>
        {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy || !password}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
