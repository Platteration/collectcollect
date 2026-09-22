import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The ticks are driven directly; the real passes would open the database and
// walk the collection, and what is under test is only what reaches the log.
vi.mock("@/lib/pricing/refresh", () => ({ refreshAll: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ sweepOrphanedUploads: vi.fn() }));

import { refreshAll } from "@/lib/pricing/refresh";
import { sweepOrphanedUploads } from "@/lib/uploads";
import { priceTick, sweepTick } from "@/lib/scheduler";

const warn = vi.spyOn(console, "warn");
const error = vi.spyOn(console, "error");

beforeEach(() => {
  warn.mockImplementation(() => {});
  error.mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the automatic price refresh", () => {
  it("reports a card the pass could not price, since refreshAll never throws for one card", async () => {
    vi.mocked(refreshAll).mockResolvedValue({ refreshed: 3, unpriced: 1, skipped: 10, failed: [{ cardId: 7, message: "HTTP 404" }] });
    await priceTick(24);
    expect(refreshAll).toHaveBeenCalledWith({ staleHours: 24 });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    // Which card and why, not only a count: the count alone cannot be acted on.
    expect(line).toContain("1 failed");
    expect(line).toContain("card 7: HTTP 404");
    expect(line).toContain("1 returned no prices");
    expect(error).not.toHaveBeenCalled();
  });

  it("says nothing about a pass in which every card was priced or fresh", async () => {
    vi.mocked(refreshAll).mockResolvedValue({ refreshed: 2, unpriced: 0, skipped: 40, failed: [] });
    await priceTick(24);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("reports a pass that could not run at all as an error, and does not throw out of the timer", async () => {
    vi.mocked(refreshAll).mockRejectedValue(new Error("database is locked"));
    await expect(priceTick(24)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the upload sweeper", () => {
  it("says what it deleted from the data directory", async () => {
    vi.mocked(sweepOrphanedUploads).mockResolvedValue({ removed: 2, bytes: 4096 });
    await sweepTick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("removed 2 photos");
    expect(String(warn.mock.calls[0][0])).toContain("4 KB");
  });

  it("is silent when there was nothing to remove", async () => {
    vi.mocked(sweepOrphanedUploads).mockResolvedValue({ removed: 0, bytes: 0 });
    await sweepTick();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a sweep that could not run as an error", async () => {
    vi.mocked(sweepOrphanedUploads).mockRejectedValue(new Error("EACCES"));
    await expect(sweepTick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
