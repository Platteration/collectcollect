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

describe("the routes the README documents and nothing in the app calls", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("lists every sale with what they realised", async () => {
    const { recordSale } = await import("@/lib/sales");
    const { seedCase } = await import("./helpers");
    const item = seedCase({ quantity: 3, purchasePrice: 1 });
    recordSale(item.id, { quantity: 2, unitPrice: 4, fees: 0.5 });
    const { GET } = await import("@/app/api/sales/route");
    const body = await read<{ sales: Array<{ quantity: number }>; realized: { sales: number; gain: number } }>(await GET());
    expect(body.sales).toHaveLength(1);
    // 2 × $4 less $0.50 of fees, against $2 of cost.
    expect(body.realized).toMatchObject({ sales: 1, gain: 5.5 });
  });

  it("hands back an item's price history, newest first, and a 404 for an item that is not there", async () => {
    const { addSnapshot } = await import("@/lib/items");
    const item = seedRedline();
    const summary = { currency: "USD" as const, market: 10, marketSource: "Skinport", yourCopyValue: 10, yourCopyBasis: "x", quotes: [], errors: [] };
    addSnapshot(item.id, { ...summary, fetchedAt: "2026-01-01T00:00:00.000Z" });
    addSnapshot(item.id, { ...summary, market: 12, yourCopyValue: 12, fetchedAt: "2026-02-01T00:00:00.000Z" });
    const { GET } = await import("@/app/api/items/[id]/prices/route");
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
    const body = await read<{ snapshots: Array<{ summary: { yourCopyValue: number } }> }>(await GET(new Request("http://localhost/x"), ctx(String(item.id))));
    expect(body.snapshots.map((s) => s.summary.yourCopyValue)).toEqual([12, 10]);
    expect((await GET(new Request("http://localhost/x"), ctx("999"))).status).toBe(404);
    expect((await GET(new Request("http://localhost/x"), ctx("abc"))).status).toBe(404);
  });

  it("takes an item in, deciding for itself whether it joins a stack", async () => {
    const { POST } = await import("@/app/api/items/intake/route");
    const post = (body: unknown) => POST(new Request("http://localhost/api/items/intake", { method: "POST", body: JSON.stringify(body) }));
    const first = await post({ marketHashName: "Clutch Case", category: "case", quantity: 2, purchasePrice: 1 });
    expect(first.status).toBe(201);
    expect((await read<{ result: string }>(first)).result).toBe("created");
    const second = await post({ marketHashName: "Clutch Case", category: "case", quantity: 3, purchasePrice: 1.5 });
    expect(second.status).toBe(200);
    expect(await read<{ result: string; item: { quantity: number } }>(second)).toMatchObject({ result: "merged", item: { quantity: 5 } });
    expect((await post({ category: "case" })).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/items/intake", { method: "POST", body: "{" }))).status).toBe(400);
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
