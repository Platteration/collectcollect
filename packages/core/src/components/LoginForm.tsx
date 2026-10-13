"use client";

import { useState } from "react";
import { api } from "../api-client";

/**
 * Resolve ?next= against this origin and refuse anything that leaves it, so a
 * crafted link cannot turn the login into an open redirect. Checking the
 * resolved origin also catches forms browsers treat as protocol-relative,
 * such as a leading "/\".
 *
 * What is checked is the path handed to the browser, not only the URL it came
 * from: resolving removes dot segments, so `/.//evil.example` resolves on this
 * origin to the path `//evil.example`, which the browser then reads as
 * protocol-relative and leaves for another site.
 */
export function safeNext(next: string, origin = window.location.origin): string {
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return "/";
    const target = url.pathname + url.search;
    return new URL(target, origin).origin === origin ? target : "/";
  } catch {
    return "/";
  }
}

export function LoginForm({ next, note = "This collection is password protected." }: { next: string; note?: string }) {
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
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {note}
        </p>
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
        {error && (
          <p className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy || !password}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
