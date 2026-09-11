import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { seedRedline } from "./helpers";

async function read<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("refreshing prices over HTTP", () => {
  beforeEach(async () => {
    setDb(openDatabase(":memory:"));
    (await import("@/app/api/prices/refresh/route")).throttle.reset();
  });

  it("refuses a stale window that is not a number of hours", async () => {
    const { POST } = await import("@/app/api/prices/refresh/route");
    for (const stale of ["", "abc", "-1"]) {
      const res = await POST(new Request(`http://localhost/api/prices/refresh?stale=${encodeURIComponent(stale)}`, { method: "POST" }));
      expect(res.status, JSON.stringify(stale)).toBe(400);
    }
  });

  it("says a refresh is already running rather than starting another", async () => {
    const { POST } = await import("@/app/api/prices/refresh/route");
    const { refreshAll } = await import("@/lib/pricing/refresh");
    seedRedline();
    // Whatever the first pass does against the network, the second caller is
    // answered before it, with a 409.
    const first = refreshAll({ fetchImpl: (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch });
    const second = await POST(new Request("http://localhost/api/prices/refresh", { method: "POST" }));
    expect(second.status).toBe(409);
    await first;
  });

  it("stops a runaway client after six in a minute", async () => {
    const { POST } = await import("@/app/api/prices/refresh/route");
    for (let i = 0; i < 6; i++) await POST(new Request("http://localhost/api/prices/refresh?stale=-1", { method: "POST" }));
    const seventh = await POST(new Request("http://localhost/api/prices/refresh?stale=-1", { method: "POST" }));
    expect(seventh.status).toBe(429);
  });
});

describe("the health check", () => {
  it("answers without opening an inventory", async () => {
    const { GET } = await import("@/app/api/health/route");
    const body = await read<{ ok: boolean; app: string; database: boolean; scheduler: { running: boolean } }>(await GET());
    expect(body.ok).toBe(true);
    expect(body.app).toBe("collectcollect-skins");
    expect(typeof body.database).toBe("boolean");
    expect(body.scheduler.running).toBe(false);
  });
});

describe("reading a Steam inventory over HTTP", () => {
  beforeEach(async () => {
    setDb(openDatabase(":memory:"));
    (await import("@/app/api/steam/import/route")).throttle.reset();
  });

  it("stops a runaway client after six reads in a minute, before asking Steam", async () => {
    const { POST } = await import("@/app/api/steam/import/route");
    const ask = () => POST(new Request("http://localhost/api/steam/import", { method: "POST", body: JSON.stringify({ steamId: "" }) }));
    for (let i = 0; i < 6; i++) expect((await ask()).status).toBe(400);
    expect((await ask()).status).toBe(429);
  });
});
