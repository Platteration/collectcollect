import { describe, expect, it } from "vitest";
import { NO_LIMIT, rateLimit, retryAfterMs } from "@collectcollect/core/limiter";

/**
 * A clock the test drives, so a limit measured in minutes can be checked in
 * milliseconds. Sleeping is what moves time forward: nothing here waits.
 */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get sleeps() {
      return sleeps;
    },
  };
}

describe("a rate limit", () => {
  it("lets the first few through without waiting", async () => {
    const clock = fakeClock();
    const limit = rateLimit(3, 1000, clock);
    for (let i = 0; i < 3; i++) await limit.take();
    expect(clock.sleeps).toEqual([]);
  });

  it("holds the next one until the window has moved", async () => {
    const clock = fakeClock();
    const limit = rateLimit(3, 1000, clock);
    for (let i = 0; i < 3; i++) await limit.take();
    await limit.take();
    // The fourth waits out the remainder of the window the first opened.
    expect(clock.sleeps).toEqual([1000]);
    expect(clock.now()).toBe(1000);
  });

  it("counts a window that has rolled off, not every request ever made", async () => {
    const clock = fakeClock();
    const limit = rateLimit(2, 1000, clock);
    await limit.take();
    await limit.take();
    clock.advance(1001);
    await limit.take();
    await limit.take();
    expect(clock.sleeps).toEqual([]);
  });

  it("does not let callers that all arrive at once oversubscribe it", async () => {
    // Each has to wait for the one in front. Checking the window in parallel
    // would let every one of them see room and go.
    const clock = fakeClock();
    const limit = rateLimit(2, 1000, clock);
    await Promise.all(Array.from({ length: 6 }, () => limit.take()));
    // Two through, then two more windows for the remaining four.
    expect(clock.sleeps).toEqual([1000, 1000]);
  });

  it("keeps working after one caller gives up", async () => {
    const clock = fakeClock();
    const limit = rateLimit(1, 1000, clock);
    const aborted = { aborted: true };
    await limit.take(aborted);
    await limit.take();
    // The abandoned turn must not take the queue with it.
    expect(clock.now()).toBeGreaterThanOrEqual(0);
    expect(limit.waiting).toBe(0);
  });

  it("reports how many are waiting", async () => {
    const clock = fakeClock();
    const limit = rateLimit(1, 1000, clock);
    const all = Promise.all([limit.take(), limit.take(), limit.take()]);
    expect(limit.waiting).toBe(3);
    await all;
    expect(limit.waiting).toBe(0);
  });

  it("has a version that never waits", async () => {
    for (let i = 0; i < 100; i++) await NO_LIMIT.take();
    expect(NO_LIMIT.waiting).toBe(0);
  });
});

describe("what a market asked for", () => {
  it("holds every caller back for as long as the market said", async () => {
    const clock = fakeClock();
    const limit = rateLimit(3, 1000, clock);
    limit.cooldown(5000);
    await limit.take();
    expect(clock.sleeps).toEqual([5000]);
    // A shorter ask never brings the pause forward.
    limit.cooldown(2000);
    limit.cooldown(500);
    await limit.take();
    expect(clock.sleeps).toEqual([5000, 2000]);
  });

  it("lets a waiting caller give up when its signal is aborted, at once", async () => {
    const limit = rateLimit(1, 60_000);
    await limit.take();
    const controller = new AbortController();
    const started = Date.now();
    const waiting = limit.take(controller.signal);
    setTimeout(() => controller.abort(), 10);
    await waiting;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(limit.waiting).toBe(0);
  });

  it("reads a Retry-After in seconds or as a date, and falls back when it says neither", () => {
    expect(retryAfterMs("30")).toBe(30_000);
    expect(retryAfterMs(" 0 ")).toBe(0);
    const now = Date.parse("2026-06-01T12:00:00Z");
    expect(retryAfterMs("Mon, 01 Jun 2026 12:00:45 GMT", now)).toBe(45_000);
    expect(retryAfterMs("Mon, 01 Jun 2026 11:00:00 GMT", now)).toBe(0);
    expect(retryAfterMs(null)).toBe(60_000);
    expect(retryAfterMs("soon", now, 1234)).toBe(1234);
  });
});
