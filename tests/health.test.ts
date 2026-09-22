import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import pkg from "../package.json";

describe("GET /api/health", () => {
  it("answers 200 with the version and nothing else", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // Exactly these two keys: the route is reachable without a session and
    // from any Host, so a data path, an environment value or a count added
    // here would be handed to anyone who can reach the port.
    expect(body).toEqual({ ok: true, version: pkg.version });
    expect(Object.keys(body as object)).toEqual(["ok", "version"]);
  });
});
