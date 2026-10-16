import type { APIRequestContext } from "@playwright/test";
import { cardPhoto } from "./helpers";
import { expect, test, watch } from "./fixtures";

/** Leave the shared collection's inbox as it was. (The browsers here map cardbox.lan; the test's own request context does not, so it asks at the plain address.) */
async function discard(request: APIRequestContext, id: string) {
  await expect(async () => {
    const { drafts } = (await (await request.get("/api/scan-drafts")).json()) as { drafts: Array<{ id: string; revision: number; status: string }> };
    const latest = drafts.find((d) => d.id === id);
    expect(latest?.status).not.toBe("identifying");
    expect((await request.post(`/api/scan-drafts/${id}/discard`, { data: { revision: latest?.revision } })).ok()).toBe(true);
  }).toPass();
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The scan page on a phone that reaches the app by its address at home, over plain http.
 * A browser offers crypto.randomUUID and the camera only to a secure context (https or
 * localhost), so for such a phone neither exists. cardbox.lan is mapped to this machine,
 * which gives the same non-loopback http origin a phone sees (auth.spec.ts does the same).
 */
test.describe("scanning from a phone over http://<address on the home network>", () => {
  test("Choose photos saves the photo, though the page has no crypto.randomUUID", async ({ playwright, baseURL, request }) => {
    const lan = `http://cardbox.lan:${new URL(baseURL!).port}`;
    const browser = await playwright.chromium.launch({
      args: ["--host-resolver-rules=MAP cardbox.lan 127.0.0.1"],
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    });
    let draftId: string | undefined;
    try {
      const context = await browser.newContext({ baseURL: lan, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
      const problems: string[] = [];
      await watch(context, lan, problems);
      const page = await context.newPage();
      // Identification would reach the model; this is about getting the photo to the inbox.
      await page.route("**/api/scan-drafts/*/identify", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not in this test" }) }));
      await page.goto("/scan");
      // The conditions that broke it: this is what a phone has at that address.
      expect(await page.evaluate(() => ({ secure: window.isSecureContext, randomUUID: typeof crypto.randomUUID, camera: typeof navigator.mediaDevices }))).toEqual({
        secure: false, randomUUID: "undefined", camera: "undefined",
      });

      const uploaded = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/uploads");
      await page.locator("input[type=file]").setInputFiles([await cardPhoto(page, [30, 120, 90])]);
      const response = await uploaded;
      expect(response.status()).toBe(200);
      const { draft } = (await response.json()) as { draft: { id: string; uploads: string[] } };
      draftId = draft.id;
      // The id the page made is one the server takes, and the photo is in the inbox.
      expect(draft.id).toMatch(UUID_V4);
      await expect(page.locator(`img[src="/api/uploads/${draft.uploads[0]}"]`)).toBeVisible();
      expect(problems).toEqual([]);
    } finally {
      await browser.close();
      if (draftId) await discard(request, draftId);
    }
  });

  test("Use camera says the live camera needs https, and that Choose photos still works", async ({ playwright, baseURL }) => {
    const lan = `http://cardbox.lan:${new URL(baseURL!).port}`;
    const browser = await playwright.chromium.launch({
      args: ["--host-resolver-rules=MAP cardbox.lan 127.0.0.1"],
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    });
    try {
      const context = await browser.newContext({ baseURL: lan, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
      const problems: string[] = [];
      await watch(context, lan, problems);
      const page = await context.newPage();
      await page.goto("/scan");
      await page.getByRole("button", { name: "Use camera" }).click();
      // Next's own route announcer is a second element with role alert, and an empty one.
      const alert = page.locator("p[role=alert]");
      await expect(alert).toContainText("The live camera needs https");
      await expect(alert).toContainText("Choose photos still works");
      // The old message was a TypeError's text, "Cannot read properties of undefined (reading 'getUserMedia')".
      await expect(alert).not.toContainText("getUserMedia");
      await expect(page.getByRole("button", { name: "Capture" })).toHaveCount(0);
      expect(problems).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test("a secure page whose browser has no camera API says so, and still points to Choose photos", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "mediaDevices", { get: () => undefined }));
    await page.goto("/scan");
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    await page.getByRole("button", { name: "Use camera" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("This browser does not offer the live camera to web pages. Choose photos still works.");
  });
});
