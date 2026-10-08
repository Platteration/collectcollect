import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { createCard } from "@/lib/cards";
import { resetRefreshThrottle } from "@/lib/pricing/refresh";
import { schedulerStatus, startPriceScheduler, stopPriceScheduler } from "@/lib/scheduler";

describe("the hourly refresh", () => {
  beforeEach(() => {
    setDb(openDatabase(":memory:"));
    resetRefreshThrottle();
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopPriceScheduler();
    vi.useRealTimers();
    delete process.env.AUTO_REFRESH_HOURS;
  });

  it("is off when told so, and says so", () => {
    process.env.AUTO_REFRESH_HOURS = "0";
    startPriceScheduler();
    expect(schedulerStatus()).toMatchObject({ enabled: false, running: false, lastRunAt: null });
  });

  it("runs a first pass after boot and records what it did", async () => {
    process.env.AUTO_REFRESH_HOURS = "24";
    // "other" has no price source, so a manual price is the whole lookup and
    // nothing here reaches the network.
    createCard({ game: "other", name: "Kept current", manualUngraded: 5 });
    startPriceScheduler({ firstAfterMs: 1000, everyMs: 60_000 });
    expect(schedulerStatus()).toMatchObject({ enabled: true, staleHours: 24, lastRunAt: null });
    await vi.advanceTimersByTimeAsync(1000);
    const status = schedulerStatus();
    expect(status.lastRunAt).not.toBeNull();
    expect(status.lastResult).toMatchObject({ refreshed: 1 });
    expect(status.lastError).toBeNull();
    // Everything is fresh now, so the next tick has nothing to do and says so.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(schedulerStatus().lastResult).toMatchObject({ refreshed: 0, skipped: 1 });
  });

  it("does not start twice", () => {
    process.env.AUTO_REFRESH_HOURS = "24";
    const timers = vi.getTimerCount();
    startPriceScheduler({ firstAfterMs: 1000, everyMs: 60_000 });
    startPriceScheduler({ firstAfterMs: 1000, everyMs: 60_000 });
    // One first-pass timeout and one interval, not two of each.
    expect(vi.getTimerCount()).toBe(timers + 2);
  });
});
