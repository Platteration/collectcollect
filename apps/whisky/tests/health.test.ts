import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../src/app/api/health/route";
import { proxy } from "../src/proxy";

/**
 * The image's HEALTHCHECK asks /api/health from inside the container, with no
 * session, whether or not a password is set; a route that answers 404, or that
 * the gate turns away, leaves the container reported unhealthy.
 */
describe("the health route", () => {
  afterEach(() => {
    delete process.env.WHISKY_APP_PASSWORD;
  });

  it("says which app this is and that its collection answers a query", async () => {
    // The suite's setup has opened an in-memory database.
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, app: "collectcollect-whisky", database: true });
  });

  it("is let through the password gate, which refuses the rest of the API", async () => {
    process.env.WHISKY_APP_PASSWORD = "a-password-for-the-test";
    const ask = (path: string) => proxy(new NextRequest(`http://127.0.0.1:3000${path}`));
    expect((await ask("/api/items")).status).toBe(401);
    const health = await ask("/api/health");
    expect(health.status).toBe(200);
    // Handed on to the route, not answered by the gate.
    expect(health.headers.get("x-middleware-next")).toBe("1");
  });
});
