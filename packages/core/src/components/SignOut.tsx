"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../api-client";

/**
 * Sign out, here or everywhere. "Everywhere" is for the phone that was lost
 * or the browser at work that was left signed in: every session issued so far
 * is ended, including this one, and the password is asked for again.
 */
export function SignOut({ everywhere = false }: { everywhere?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const leave = async () => {
    if (everywhere && !confirm("Sign out everywhere? Every device signed in to this app, including this one, will have to sign in again.")) return;
    setBusy(true);
    setError(null);
    try {
      if (everywhere) await api("/api/auth/revoke", { method: "POST" });
      else await api("/api/auth", { method: "DELETE" }).catch(() => undefined);
      router.replace("/login");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (everywhere) {
    return (
      <div className="space-y-2">
        <button type="button" className="btn-secondary" onClick={leave} disabled={busy}>
          {busy ? "Signing out…" : "Sign out everywhere"}
        </button>
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-raised)]"
      style={{ color: "var(--muted)" }}
      onClick={leave}
      disabled={busy}
    >
      Sign out
    </button>
  );
}
