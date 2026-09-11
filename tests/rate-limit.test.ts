import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGIN_FAILURE_DELAY_MS,
  LOGIN_FAILURE_MAX_DELAY_MS,
  LOGIN_GLOBAL_MAX_ATTEMPTS,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_ATTEMPTS,
  clearLoginFailures,
  clientKey,
  loginBlocked,
  loginFailureDelay,
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
  delete process.env.TRUSTED_PROXY_HOPS;
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
    expect(clientKey(req("1.2.3.4"))).toBeNull();
    expect(clientKey(req("1.2.3.4, 5.6.7.8"))).toBeNull();
    expect(clientKey(req())).toBeNull();
  });

  it("reads the hop the nearest proxy wrote, not the one the client typed", () => {
    // nginx's $proxy_add_x_forwarded_for and Caddy's default both APPEND, so the
    // leftmost entry is the client's own text and the rightmost is what the
    // proxy observed. Reading from the left is how one caller gets a fresh
    // bucket per guess, and how they name someone else's address to lock them out.
    process.env.TRUST_PROXY = "1";
    expect(clientKey(req("198.51.100.9, 203.0.113.5"))).toBe("203.0.113.5");
    expect(clientKey(req("not-an-address, 203.0.113.5"))).toBe("203.0.113.5");
    expect(clientKey(req("203.0.113.5:41234"))).toBe("203.0.113.5");
    expect(clientKey(req("[2001:db8::1]:41234"))).toBe("2001:db8::1");

    // Two proxies: the client is two from the right, and a chain too short for
    // that was not written by them.
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientKey(req("198.51.100.9, 203.0.113.5, 10.0.0.1"))).toBe("203.0.113.5");
    expect(clientKey(req("203.0.113.5"))).toBeNull();
  });

  it("gives no key at all for anything that is not an address", () => {
    process.env.TRUST_PROXY = "1";
    expect(clientKey(req("not-an-address"))).toBeNull();
    expect(clientKey(req("unknown, still-not-an-address"))).toBeNull();
    expect(clientKey(req())).toBeNull();
  });

  it("locks a key out and keeps it out for the whole lockout", () => {
    const t = 5_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect(loginBlocked("203.0.113.5", t)).toBe(false);
      recordLoginFailure("203.0.113.5", t);
    }
    expect(loginBlocked("203.0.113.5", t)).toBe(true);
    expect(loginBlocked("203.0.113.5", t + LOGIN_LOCKOUT_MS - 1)).toBe(true);
    expect(loginBlocked("203.0.113.5", t + LOGIN_LOCKOUT_MS + 1)).toBe(false);
    // The right password clears it.
    recordLoginFailure("203.0.113.5", t);
    clearLoginFailures("203.0.113.5");
    expect(loginBlocked("203.0.113.5", t)).toBe(false);
  });

  it("has no bucket to fill when the caller cannot be identified", () => {
    // Collapsing every caller onto one key made eight wrong guesses from a
    // stranger enough to lock the owner out of their own collection, forever,
    // for eight requests every fifteen minutes.
    const t = 6_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS * 2; i++) recordLoginFailure(null, t);
    expect(loginBlocked(null, t)).toBe(false);
    // And a caller who can be identified is not dragged in by them.
    expect(loginBlocked("203.0.113.5", t)).toBe(false);
  });

  it("still stops a guesser nobody can tell apart, by the process-wide ceiling", () => {
    const t = 7_000_000;
    for (let i = 0; i < LOGIN_GLOBAL_MAX_ATTEMPTS; i++) {
      expect(loginBlocked(null, t)).toBe(false);
      recordLoginFailure(null, t);
    }
    expect(loginBlocked(null, t)).toBe(true);
    expect(loginBlocked("brand-new-key", t)).toBe(true);
  });

  it("charges a wrong guess wall clock that grows with the bucket", () => {
    // The cost, not a refusal, is what carries the throttle when no proxy names
    // the caller: a cost cannot be turned on somebody else.
    expect(loginFailureDelay(1)).toBe(LOGIN_FAILURE_DELAY_MS);
    expect(loginFailureDelay(2)).toBe(LOGIN_FAILURE_DELAY_MS * 2);
    expect(loginFailureDelay(3)).toBe(LOGIN_FAILURE_DELAY_MS * 4);
    expect(loginFailureDelay(50)).toBe(LOGIN_FAILURE_MAX_DELAY_MS);
    // Growing means growing, whatever the two constants are.
    expect(loginFailureDelay(4)).toBeGreaterThan(loginFailureDelay(3));
    expect(loginFailureDelay(50)).toBeGreaterThanOrEqual(loginFailureDelay(4));
  });

  it("counts each failure and reports the count that sets the cost", () => {
    const t = 8_000_000;
    expect(recordLoginFailure("203.0.113.5", t)).toBe(1);
    expect(recordLoginFailure("203.0.113.5", t)).toBe(2);
    expect(recordLoginFailure("198.51.100.9", t)).toBe(1);
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
