import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

afterEach(() => {
  delete process.env.SKINS_APP_PASSWORD;
  delete process.env.ALLOWED_HOSTS;
});

function request(url: string, opts: { method?: string; host?: string; origin?: string; site?: string } = {}): NextRequest {
  const headers = new Headers();
  headers.set("host", opts.host ?? new URL(url).host);
  if (opts.origin) headers.set("origin", opts.origin);
  if (opts.site) headers.set("sec-fetch-site", opts.site);
  return new NextRequest(url, { method: opts.method ?? "GET", headers });
}

const status = async (req: NextRequest) => (await proxy(req)).status;

/**
 * The gate is shared with the card app and tested in depth there; this holds
 * the skins wiring to the same rules, on the routes that matter most here.
 */
describe("the shared gate, wired into the skins app", () => {
  it("refuses a rebound host name and a cross-site write, with no password set", async () => {
    expect(await status(request("http://localhost:3001/api/backup", { host: "rebind.attacker.example" }))).toBe(403);
    const restore = await proxy(request("http://localhost:3001/api/backup/restore", { method: "POST", site: "cross-site" }));
    expect(restore.status).toBe(403);
    expect(await restore.json()).toEqual({ error: "Cross-site request refused." });
    expect(restore.headers.get("Content-Security-Policy")).toMatch(/default-src 'self'/);
    // The card app on the port beside this one is another origin.
    expect(await status(request("http://localhost:3001/api/items", { method: "POST", origin: "http://localhost:3000" }))).toBe(403);
  });

  it("lets the app's own writes, header-free clients and reads through", async () => {
    expect(await status(request("http://localhost:3001/api/items", { method: "POST", site: "same-origin", origin: "http://localhost:3001" }))).toBe(200);
    expect(await status(request("http://localhost:3001/api/items", { method: "POST" }))).toBe(200);
    expect(await status(request("http://skinsbox.local:3001/api/items", { site: "cross-site" }))).toBe(200);
  });

  it("keeps the health check reachable by address whatever ALLOWED_HOSTS names, and the inventory behind it", async () => {
    process.env.SKINS_APP_PASSWORD = "hunter2";
    process.env.ALLOWED_HOSTS = "skins.example.com";
    expect(await status(request("http://127.0.0.1:3001/api/health"))).toBe(200);
    expect(await status(request("http://127.0.0.1:3001/api/items"))).toBe(403);
    expect(await status(request("http://localhost:3001/api/items", { host: "skins.example.com" }))).toBe(401);
  });
});
