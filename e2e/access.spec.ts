import { expect, test } from "@playwright/test";
import { cardPhoto } from "./helpers";

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
  });

  test("bytes that came from a client are served as the image they are", async ({ page, request }) => {
    // The headers on a real 200: a missing name 404s before the route sets any
    // of them, so only an upload that exists exercises this path at all.
    await page.goto("/");
    const photo = await cardPhoto(page, [90, 140, 210]);
    const stored = await request.post("/api/uploads", {
      headers: { "sec-fetch-site": "same-origin" },
      multipart: { files: photo },
    });
    expect(stored.status()).toBe(200);
    const { uploads } = (await stored.json()) as { uploads: Array<{ name: string }> };
    expect(uploads).toHaveLength(1);

    const served = await request.get(`/api/uploads/${uploads[0].name}`);
    expect(served.status()).toBe(200);
    // The route's own contribution: every upload is re-encoded to JPEG, and the
    // name is a fresh UUID, so the bytes are immutable and private to this user.
    expect(served.headers()["content-type"]).toBe("image/jpeg");
    expect(served.headers()["cache-control"]).toBe("private, max-age=31536000, immutable");
    // Client-supplied bytes served from this origin must not be sniffed. The
    // header comes from the app-wide config, which has to keep covering this
    // route and not only the pages.
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");
    // A name that is well formed but has never been stored is still a 404.
    const missing = await request.get("/api/uploads/00000000-0000-4000-8000-000000000000.jpg");
    expect(missing.status()).toBe(404);
  });

  /**
   * Adding src/proxy.ts made Next clone and buffer the body of every request,
   * and past `experimental.proxyClientMaxBodySize` it truncates the body rather
   * than refusing the request — so the route sees a body that ends mid-stream.
   * That silently broke restore-from-backup, the app's only recovery path, for
   * any collection over 10 MB, and reported it as "Expected multipart/form-data"
   * — which reads as "your archive is the wrong type", not "it was cut in half".
   */
  test("a body larger than Next's default buffer arrives whole", async ({ request }) => {
    // Over the 10 MB default, under the app's own ceilings, so what comes back
    // has to be the route's opinion of the content rather than a parse failure.
    const twelveMB = Buffer.alloc(12 * 1024 * 1024, 0x37);

    const upload = await request.post("/api/uploads", {
      headers: { "sec-fetch-site": "same-origin" },
      multipart: { files: { name: "big.jpg", mimeType: "image/jpeg", buffer: twelveMB } },
    });
    expect(upload.status()).toBe(400);
    // The decoder looked at all of it, which it could not have done with half a
    // multipart body; a truncated one never gets past formData().
    expect((await upload.json()).error).toMatch(/not a JPEG, PNG, WebP or HEIC/);

    const restore = await request.post("/api/backup/restore", {
      headers: { "sec-fetch-site": "same-origin" },
      multipart: { archive: { name: "big.zip", mimeType: "application/zip", buffer: twelveMB } },
    });
    expect(restore.status()).toBe(400);
    expect((await restore.json()).error).toMatch(/not a zip archive/);
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
