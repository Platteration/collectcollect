import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, setDb, getDb, closeDatabase } from "@/lib/db";
import { createPriceJobs, type JobRefreshOptions } from "@collectcollect/core/price-jobs";
beforeEach(() => setDb(openDatabase(":memory:")));
afterEach(() => { closeDatabase(); setDb(undefined); });
describe("persistent price jobs", () => {
  it("shares active promises across factories using the same connection", async () => {
    let finish!: () => void;
    const spec = { db: getDb, ids: () => [1], running: () => false, refresh: (opts: JobRefreshOptions) => new Promise<void>((resolve) => { finish = () => { opts.onProgress?.({ id: 1, status: "priced" }); resolve(); }; }) };
    const first = createPriceJobs(spec);
    const job = first.start();
    const otherRouteModule = createPriceJobs(spec);
    expect(otherRouteModule.get(job.id)?.status).toBe("running");
    expect(() => otherRouteModule.start()).toThrow(/already running/);
    finish();
    await vi.waitFor(() => expect(otherRouteModule.get(job.id)?.status).toBe("complete"));
  });

  it("records synchronous failures and lets the next request retry", async () => {
    const refresh = vi.fn<(opts: JobRefreshOptions) => Promise<void>>().mockImplementationOnce(() => { throw new Error("could not start"); })
      .mockImplementation(async (opts) => { opts.onProgress?.({ id: 1, status: "priced" }); });
    const jobs = createPriceJobs({ db: getDb, ids: () => [1], running: () => false, refresh });
    expect(() => jobs.start()).toThrow("could not start");
    expect(jobs.latest()).toMatchObject({ status: "interrupted", error: "could not start" });
    const retry = jobs.retry(jobs.latest()!.id);
    await vi.waitFor(() => expect(jobs.get(retry.id)?.status).toBe("complete"));
  });

  it("deduplicates progress and distinguishes missing work from removed holdings", async () => {
    let ids = [1, 2, 3];
    const jobs = createPriceJobs({ db: getDb, ids: () => ids, running: () => false, refresh: async (opts) => {
      opts.onProgress?.({ id: 1, status: "unpriced" }); opts.onProgress?.({ id: 1, status: "priced" });
      ids = [1, 2];
    } });
    const job = jobs.start();
    await vi.waitFor(() => expect(jobs.get(job.id)?.status).toBe("interrupted"));
    expect(jobs.get(job.id)?.outcomes).toEqual([
      { id: 1, status: "priced" },
      { id: 2, status: "failed", message: "This item did not finish. Retry its price." },
      { id: 3, status: "skipped", message: "This holding was removed or sold out." },
    ]);
  });

  it("does not call providers for an empty selection or reject unhandled after a close", async () => {
    let finish!: () => void;
    const refresh = vi.fn((opts: JobRefreshOptions) => new Promise<void>((resolve) => { finish = () => { resolve(); }; void opts; }));
    const jobs = createPriceJobs({ db: getDb, ids: () => [1], running: () => false, refresh });
    const empty = jobs.start([]);
    await vi.waitFor(() => expect(jobs.get(empty.id)?.status).toBe("complete"));
    expect(refresh).not.toHaveBeenCalled();
    jobs.start(); closeDatabase(); finish();
    // A stale callback must finish quietly without writing to a new collection.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  it("records partial progress and retries only failed or unpriced selections", async () => {
    const refresh = vi.fn(async (opts: JobRefreshOptions) => {
      for (const id of opts.ids ?? []) opts.onProgress?.({ id, status: id === 1 ? "priced" : "unpriced" });
    });
    const jobs = createPriceJobs({ db: getDb, ids: () => [1, 2], running: () => false, refresh });
    const job = jobs.start();
    await vi.waitFor(() => expect(jobs.get(job.id)?.status).toBe("complete"));
    expect(jobs.get(job.id)?.outcomes).toEqual([{ id: 1, status: "priced" }, { id: 2, status: "unpriced" }]);
    const retried = jobs.retry(job.id);
    await vi.waitFor(() => expect(jobs.get(retried.id)?.status).toBe("complete"));
    expect(refresh.mock.calls[1]?.[0].ids).toEqual([2]);
  });
  it("refuses overlapping runs and reports interrupted work after restart", async () => {
    let finish: () => void = () => undefined;
    const jobs = createPriceJobs({ db: getDb, ids: () => [1], running: () => false, refresh: (opts) => new Promise<void>(r => { finish = () => { opts.onProgress?.({ id: 1, status: "priced" }); r(); }; }) });
    const first = jobs.start();
    expect(() => jobs.start()).toThrow(/already running/);
    finish();
    await vi.waitFor(() => expect(jobs.get(first.id)?.status).toBe("complete"));
    getDb().prepare("INSERT INTO price_jobs(id,status,created_at,ids) VALUES('interrupted','running',?,'[1]')").run(new Date().toISOString());
    const restarted = createPriceJobs({ db: getDb, ids: () => [1], running: () => false, refresh: async () => undefined });
    expect(restarted.get("interrupted")).toMatchObject({ status: "interrupted", total: 1 });
  });
});
