import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { resetRefreshThrottle } from "@/lib/pricing/refresh";
import { resetCatalogue } from "@/lib/pricing/providers/skinport";
import { schedulerStatus, startPriceScheduler, stopPriceScheduler } from "@/lib/scheduler";

describe("the hourly refresh", () => {
  beforeEach(() => {
    setDb(openDatabase(":memory:"));
    resetRefreshThrottle();
    resetCatalogue();
    // The pass primes the Skinport catalogue, which must not reach the network here.
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopPriceScheduler();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.SKINS_AUTO_REFRESH_HOURS;
  });

  it("is off when told so, and says so", () => {
    process.env.SKINS_AUTO_REFRESH_HOURS = "0";
    startPriceScheduler();
    expect(schedulerStatus()).toMatchObject({ enabled: false, running: false, lastRunAt: null });
  });

  it("runs a first pass after boot and records what it did", async () => {
    process.env.SKINS_AUTO_REFRESH_HOURS = "24";
    // An empty inventory: the pass runs, prices nothing, and reaches no market.
    startPriceScheduler({ firstAfterMs: 1000, everyMs: 60_000 });
    expect(schedulerStatus()).toMatchObject({ enabled: true, staleHours: 24, lastRunAt: null });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    const status = schedulerStatus();
    expect(status.lastRunAt).not.toBeNull();
    expect(status.lastResult).toMatchObject({ refreshed: 0, skipped: 0 });
    // The catalogue that would not load is reported, not hidden.
    expect(status.lastResult!.providerErrors.map((e) => e.source)).toContain("Skinport");
    expect(status.running).toBe(false);
  });

  it("does not start twice", () => {
    process.env.SKINS_AUTO_REFRESH_HOURS = "24";
    const timers = vi.getTimerCount();
    startPriceScheduler({ firstAfterMs: 1000, everyMs: 60_000 });
    startPriceScheduler({ firstAfterMs: 1000, everyMs: 60_000 });
    expect(vi.getTimerCount()).toBe(timers + 2);
  });
});
