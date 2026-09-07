"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth", { method: "POST", body: JSON.stringify({ password }) });
      // A relative path only, so a crafted ?next= cannot bounce to another site.
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
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
