import { expect, test } from "@playwright/test";

/**
 * The proxy's two guards, checked against the running server rather than the
 * function: a hostile page must not be able to spend the API budget or replace
 * the collection, and the app must not answer to a name someone else can point
 * at this machine.
 */
test.describe("access guards", () => {
  test("a write that a browser sent from another site is refused", async ({ request }) => {
    const attempts: Array<Record<string, string>> = [
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "cross-site" },
      { origin: "https://evil.example" },
    ];
    for (const headers of attempts) {
      const res = await request.post("/api/prices/refresh", { headers });
      expect(res.status()).toBe(403);
    }
    // A multipart body is CORS-safelisted, so the restore route needs the same guard.
    const restore = await request.post("/api/backup/restore", {
      headers: { "sec-fetch-site": "cross-site" },
      multipart: { archive: { name: "b.zip", mimeType: "application/zip", buffer: Buffer.from("PK") } },
    });
    expect(restore.status()).toBe(403);
  });

  test("a request carrying a host this server does not answer to is refused", async ({ request }) => {
    const res = await request.get("/api/cards", { headers: { host: "rebind.attacker.example" } });
    expect(res.status()).toBe(403);
  });

  test("every response carries the security headers", async ({ request }) => {
    const page = await request.get("/", { headers: { "sec-fetch-site": "same-origin" } });
    const csp = page.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Card art and price-source links come from third-party https hosts.
    expect(csp).toContain("img-src 'self' https: data: blob:");
    expect(page.headers()["x-content-type-options"]).toBe("nosniff");
    expect(page.headers()["referrer-policy"]).toBe("no-referrer");
    expect(page.headers()["x-frame-options"]).toBe("DENY");

    // Uploaded bytes are served from this origin, so they must not be sniffed.
    const photo = await request.get("/api/uploads/00000000-0000-4000-8000-000000000000.jpg");
    expect(photo.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("the app's own requests are unaffected", async ({ request }) => {
    expect((await request.get("/api/cards", { headers: { "sec-fetch-site": "same-origin" } })).status()).toBe(200);
    // A write reaches the route: the 400 is the route's own validation, not the guard.
    const write = await request.post("/api/cards", {
      headers: { "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3210" },
      data: {},
    });
    expect(write.status()).toBe(400);
  });
});
