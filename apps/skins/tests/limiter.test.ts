import { describe, expect, it } from "vitest";
import { NO_LIMIT, rateLimit } from "@collectcollect/core/limiter";

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
