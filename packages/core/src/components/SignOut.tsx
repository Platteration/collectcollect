"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "../api-client";

/**
 * Sign out, here or everywhere. "Everywhere" is for the phone that was lost
 * or the browser at work that was left signed in: every session issued so far
 * is ended, including this one, and the password is asked for again.
 *
 * A sign-out the server did not confirm is said, not passed over: going on to
 * the login page anyway showed someone the password form while the browser
 * was still signed in (a request that never arrived), or hid the server's
 * warning that a copy of the cookie still works (a session it could not end).
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
      await (everywhere ? api("/api/auth/revoke", { method: "POST" }) : api("/api/auth", { method: "DELETE" }));
      router.replace("/login");
      router.refresh();
    } catch (e) {
      // The server's own words when it answered; when it did not, nothing was signed out.
      setError(e instanceof ApiError ? e.message : "The server could not be reached, so this browser is still signed in. Try again.");
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
    <>
      <button
        type="button"
        className="cc-signout rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-raised)]"
        style={{ color: "var(--muted)" }}
        onClick={leave}
        disabled={busy}
      >
        Sign out
      </button>
      {error && (
        <p role="alert" className="w-full text-right text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}
    </>
  );
}
