import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGIN_GLOBAL_MAX_ATTEMPTS,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_ATTEMPTS,
  clearLoginFailures,
  clientKey,
  loginBlocked,
  rateLimit,
  recordLoginFailure,
  resetLimiters,
} from "@/lib/rate-limit";
import { openDatabase, setDb } from "@/lib/db";
import { createCard } from "@/lib/cards";
import { refreshAll } from "@/lib/pricing/refresh";

beforeEach(() => resetLimiters());
afterEach(() => {
  delete process.env.TRUST_PROXY;
  vi.unstubAllGlobals();
});

describe("fixed-window limiter", () => {
  it("allows a limit's worth per window and then reports how long to wait", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("x", 3, 60_000, t).ok).toBe(true);
    const refused = rateLimit("x", 3, 60_000, t + 10_000);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfter).toBe(50);
    // Buckets are independent, and the window eventually refills.
    expect(rateLimit("y", 3, 60_000, t).ok).toBe(true);
    expect(rateLimit("x", 3, 60_000, t + 60_000).ok).toBe(true);
  });
});

describe("login attempt limiter", () => {
  const req = (forwarded?: string) =>
    new Request("http://localhost:3000/api/auth", {
      method: "POST",
      headers: forwarded ? { "x-forwarded-for": forwarded } : {},
    });

  it("ignores X-Forwarded-For unless a proxy is declared", () => {
    // The client sets this header, so trusting it hands out a fresh key per guess.
    expect(clientKey(req("1.2.3.4"))).toBe("local");
    expect(clientKey(req("1.2.3.4, 5.6.7.8"))).toBe("local");
    expect(clientKey(req())).toBe("local");
    process.env.TRUST_PROXY = "1";
    expect(clientKey(req("1.2.3.4, 5.6.7.8"))).toBe("1.2.3.4");
    expect(clientKey(req())).toBe("local");
  });

  it("locks a key out and keeps it out for the whole lockout", () => {
    const t = 5_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect(loginBlocked("local", t)).toBe(false);
      recordLoginFailure("local", t);
    }
    expect(loginBlocked("local", t)).toBe(true);
    expect(loginBlocked("local", t + LOGIN_LOCKOUT_MS - 1)).toBe(true);
    expect(loginBlocked("local", t + LOGIN_LOCKOUT_MS + 1)).toBe(false);
    // The right password clears it.
    recordLoginFailure("local", t);
    clearLoginFailures("local");
    expect(loginBlocked("local", t)).toBe(false);
  });

  it("still stops a guesser who rotates the key on every attempt", () => {
    const t = 7_000_000;
    for (let i = 0; i < LOGIN_GLOBAL_MAX_ATTEMPTS; i++) {
      const key = `10.0.0.${i}`;
      expect(loginBlocked(key, t)).toBe(false);
      recordLoginFailure(key, t);
    }
    expect(loginBlocked("10.0.0.999", t)).toBe(true);
    expect(loginBlocked("brand-new-key", t)).toBe(true);
  });
});

describe("collection-wide price refresh", () => {
  beforeEach(() => {
    setDb(openDatabase(":memory:"));
    createCard({ game: "pokemon", name: "Charizard", cardNumber: "4/102" });
    createCard({ game: "pokemon", name: "Blastoise", cardNumber: "2/102" });
  });

  it("folds concurrent callers into one pass over the collection", async () => {
    const calls = { n: 0 };
    vi.stubGlobal("fetch", async () => {
      calls.n += 1;
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const first = refreshAll();
    const second = refreshAll();
    // Not merely equal: the second caller joined the pass already running.
    expect(second).toBe(first);
    const [a, b] = await Promise.all([first, second]);
    expect(b).toBe(a);
    const oneSweep = calls.n;
    expect(oneSweep).toBeGreaterThan(0);

    // The guard is released once the pass finishes, so a later call runs again.
    calls.n = 0;
    const later = refreshAll();
    expect(later).not.toBe(first);
    await later;
    expect(calls.n).toBe(oneSweep);
  });
});
