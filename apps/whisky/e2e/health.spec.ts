import { expect, test } from "./fixtures";

test.describe("the health check", () => {
  test("says the server is up and that the seeded collection answers a query", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true, app: "collectcollect-whisky", database: true });
    expect(res.headers()["cache-control"]).toBe("no-store");
  });
});
