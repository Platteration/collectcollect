import { jsonError } from "./http";

/**
 * Who is asking, for anything that counts requests per client.
 *
 * `X-Forwarded-For` is only believed when `TRUST_PROXY` says there is a proxy
 * in front to have set it. Anyone can send that header, and a limiter keyed on
 * it without a proxy is a limiter every client can reset by changing one
 * string. Without a proxy every request is "local", which for an app that
 * runs on one machine for one person is the truth.
 */
export function clientKey(request: Request): string {
  const trusted = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? "");
  if (!trusted) return "local";
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0] : null)?.trim() || "local";
}

export interface Throttle {
  /** A 429 for this request, or null when it may go ahead. */
  check(request: Request, now?: number): Response | null;
  /** Forget everything, for tests. */
  reset(): void;
}

/**
 * At most `max` requests per client in any `windowMs`, for the routes that
 * cost something: an image sent to a vision model, a whole-inventory refresh
 * against rate-limited markets, a restore that swaps the database out.
 *
 * In memory and per process, which is the right size here — it is protection
 * against a runaway client or a double-clicked button, not a public API's
 * defence. Entries are pruned as they expire, so a long-running server does
 * not hold a row for every client it ever saw.
 */
export function createThrottle(max: number, windowMs: number, what = "requests"): Throttle {
  const seen = new Map<string, number[]>();
  const CAP = 10_000;

  const prune = (now: number) => {
    for (const [key, stamps] of seen) {
      while (stamps.length && now - stamps[0] >= windowMs) stamps.shift();
      if (!stamps.length) seen.delete(key);
    }
  };

  return {
    check(request, now = Date.now()) {
      prune(now);
      const key = clientKey(request);
      let stamps = seen.get(key);
      if (!stamps) {
        // A flood of distinct keys cannot grow this without bound.
        if (seen.size >= CAP) seen.clear();
        stamps = [];
        seen.set(key, stamps);
      }
      if (stamps.length >= max) {
        const retryAfter = Math.max(1, Math.ceil((windowMs - (now - stamps[0])) / 1000));
        const response = jsonError(`Too many ${what}; try again in ${retryAfter}s`, 429);
        response.headers.set("Retry-After", String(retryAfter));
        return response;
      }
      stamps.push(now);
      return null;
    },
    reset() {
      seen.clear();
    },
  };
}
