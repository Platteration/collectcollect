"use client";

import { useEffect, useState } from "react";
import { api } from "../api-client";
import type { GoogleOffer } from "../google-config";

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

/**
 * The login page: the password form when a password is set, the way to sign in
 * with Google when that is set up (google-config.ts, googleOffer), and, back
 * from a sign-in with Google that did not finish, a line that says so once.
 */
export function LoginForm({
  next,
  note = "This collection is password protected.",
  passwordSet = true,
  google = null,
  signinFailed = false,
}: {
  next: string;
  note?: string;
  passwordSet?: boolean;
  google?: GoogleOffer;
  signinFailed?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Said once: the address loses ?signin=failed, so a reload does not say it again.
  useEffect(() => {
    if (!signinFailed) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("signin");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [signinFailed]);

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
      <div className="card-surface space-y-3 p-6">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Sign in</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {note}
        </p>
        {signinFailed && (
          <p role="alert" className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
            Sign-in didn&apos;t complete.
          </p>
        )}
        {passwordSet && (
          <form onSubmit={submit} className="space-y-3">
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
        )}
        {/* A plain link, a top-level navigation: it works before any script has run. */}
        {google?.kind === "ready" && (
          <a href={google.href} className={`${passwordSet ? "btn-secondary" : "btn-primary"} w-full`}>
            Sign in with Google
          </a>
        )}
        {google?.kind === "broken" && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Sign-in with Google is switched on but not fully set up, so it is not offered here; the server&apos;s log says what is
            missing.
          </p>
        )}
      </div>
    </div>
  );
}
