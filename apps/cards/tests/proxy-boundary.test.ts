import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Auth } from "@collectcollect/core/auth";
import { createProxy } from "@collectcollect/core/proxy";

describe("shared proxy before the passwordless bypass", () => {
  const proxy = createProxy({ authEnabled: () => false } as Auth, []);
  it("rejects hostile requests even with authentication disabled, retaining security headers", async () => {
    const response = await proxy(new NextRequest("http://rebind.example/api/cards"));
    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const write = await proxy(new NextRequest("http://localhost/api/cards", { method: "POST", headers: { Origin: "https://attacker.example" }, body: "{}" }));
    expect(write.status).toBe(403);
  });
});
