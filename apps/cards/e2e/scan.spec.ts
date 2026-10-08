import { expect } from "@playwright/test";
import { cardPhoto } from "./helpers";
import { test } from "./scan-fixture";

test("scan mode adds, merges and sets aside cards without intervention", async ({ page, scan }) => {
  const fixture = await scan([
    { name: "Scanned Charizard", card_number: "4/102" },
    { name: "Scanned Pikachu", set_name: "Jungle", card_number: "60/64" },
    // A distinct photo of the same card must create one additional purchase lot.
    { name: "Scanned Charizard", card_number: "4/102" },
    { name: "Scanned Blastoise", card_number: "2/102", confidence: 0.4 },
  ]);
  await page.goto("/scan");
  await page.locator("input[type=file]").setInputFiles(fixture.photos);

  await expect.poll(async () => (await fixture.drafts()).map((draft) => `${draft.status}:${draft.result ?? ""}`).sort(), { timeout: 30_000 })
    .toEqual(["committed:created", "committed:created", "committed:merged", "review:"]);
  await expect(page.getByText("2 added", { exact: true })).toBeVisible();
  await expect(page.getByText("1 extra copies", { exact: true })).toBeVisible();
  await expect(page.getByText("1 need review", { exact: true })).toBeVisible();
  await expect(page.getByText(`Only 40% sure this is ${fixture.name(3)}.`, { exact: true })).toBeVisible();

  await page.goto(`/collection?q=${fixture.suffix}`);
  await expect(page.getByRole("link", { name: new RegExp(fixture.name(0)) })).toBeVisible();
  await expect(page.getByText("×2", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(fixture.name(1)) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(fixture.name(3)) })).toHaveCount(0);
});

test("a busy identifier is waited out and the card still lands", async ({ page, scan }) => {
  const fixture = await scan([{ name: "Patient Psyduck", set_name: "Fossil", card_number: "53/62" }], true);
  await page.goto("/scan");
  await page.locator("input[type=file]").setInputFiles(fixture.photos);
  await expect(page.locator("li").filter({ hasText: fixture.name(0) }).getByRole("link", { name: "Open card" })).toBeVisible({ timeout: 30_000 });
  await page.goto(`/collection?q=${fixture.suffix}`);
  await expect(page.getByRole("link", { name: new RegExp(fixture.name(0)) })).toBeVisible();
});

test("uncertain scans survive reload and save from the existing photo", async ({ page, scan }) => {
  const fixture = await scan([{ name: "Resume Snorlax", confidence: 0.3 }]);
  const name = fixture.name(0);
  const reviewedName = `Reviewed Snorlax ${fixture.suffix}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/scan");
  await page.locator("input[type=file]").setInputFiles(fixture.photos);
  await expect(page.getByText(`Only 30% sure this is ${name}.`, { exact: true })).toBeVisible();
  await page.reload();
  await page.locator("li").filter({ hasText: name }).getByRole("button", { name: "Review", exact: true }).click();
  const editor = page.getByRole("region", { name: "Review scanned card" });
  await editor.getByLabel("Card name", { exact: true }).fill(reviewedName);
  await editor.getByLabel("Add back or label photo").setInputFiles([await cardPhoto(page, [10, 30, 60])]);
  await expect(editor.getByText("2 saved photos", { exact: true })).toBeVisible();
  const [saved] = await Promise.all([
    page.waitForResponse((response) => /\/api\/scan-drafts\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH"),
    editor.getByRole("button", { name: "Save draft", exact: true }).click(),
  ]);
  expect(saved.ok()).toBe(true);
  await page.reload();
  await page.locator("li").filter({ hasText: reviewedName }).getByRole("button", { name: "Review", exact: true }).click();
  await expect(editor.getByRole("img", { name: "Saved photo 2" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/scan-review-mobile.png", fullPage: true });
  await editor.getByRole("button", { name: "Save to collection" }).click();
  await expect(page.locator("li").filter({ hasText: reviewedName }).getByRole("link", { name: "Open card" })).toBeVisible();
  await page.goto(`/collection?q=${fixture.suffix}`);
  await expect(page.getByRole("link", { name: new RegExp(reviewedName) })).toHaveCount(1);
});

test("polling preserves local edits and a stale save cannot overwrite another tab", async ({ page, request, scan }) => {
  const fixture = await scan([{ name: "Two tabs Eevee", confidence: 0.2 }]);
  const name = fixture.name(0);
  const localName = `Unsaved local Eevee ${fixture.suffix}`;
  const otherName = `Saved in other tab ${fixture.suffix}`;
  await page.goto("/scan");
  await page.locator("input[type=file]").setInputFiles(fixture.photos);
  await expect(page.getByText(`Only 20% sure this is ${name}.`, { exact: true })).toBeVisible();
  await page.locator("li").filter({ hasText: name }).getByRole("button", { name: "Review", exact: true }).click();
  const editor = page.getByRole("region", { name: "Review scanned card" });
  await editor.getByLabel("Card name", { exact: true }).fill(localName);
  const drafts = await fixture.drafts();
  expect(drafts).toHaveLength(1);
  const draft = drafts[0]!;
  const response = await request.patch(`/api/scan-drafts/${draft.id}`, { data: { revision: draft.revision, input: { name: otherName } } });
  expect(response.ok()).toBe(true);
  await expect(editor.getByText(/Your unsaved edits are still here/)).toBeVisible({ timeout: 10_000 });
  await expect(editor.getByLabel("Card name", { exact: true })).toHaveValue(localName);
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("changed in another tab");
  await expect(editor.getByLabel("Card name", { exact: true })).toHaveValue(localName);
  await editor.getByRole("button", { name: "Reload and discard my edits" }).click();
  await expect(editor.getByLabel("Card name", { exact: true })).toHaveValue(otherName);
});

test("a result that becomes ready after reload saves once through polling", async ({ page, scan }) => {
  const fixture = await scan([{ name: "Later Lapras", confidence: 0.3 }]);
  await page.goto("/scan");
  await page.locator("input[type=file]").setInputFiles(fixture.photos);
  const tile = page.locator("li").filter({ hasText: fixture.name(0) });
  await expect(tile.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  await page.reload();
  await expect(tile.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  // Publish a completed server result after the new page's initial props. No
  // response from this fixture reaches the page; polling must discover/save it.
  expect((await fixture.publishResult(0, { confidence: 0.95 })).status).toBe("ready");
  await expect(tile.getByRole("link", { name: "Open card" })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(tile.getByRole("link", { name: "Open card" })).toBeVisible();
  const response = await page.request.get(`/api/cards?q=${fixture.suffix}`);
  const { cards } = await response.json() as { cards: Array<{ quantity: number }> };
  expect(cards).toHaveLength(1);
  expect(cards[0]?.quantity).toBe(1);
});

test("another tab can discard a scan without erasing open unsaved edits", async ({ page, request, scan }) => {
  const fixture = await scan([{ name: "Discarded Ditto", confidence: 0.2 }]);
  await page.goto("/scan");
  await page.locator("input[type=file]").setInputFiles(fixture.photos);
  const tile = page.locator("li").filter({ hasText: fixture.name(0) });
  await tile.getByRole("button", { name: "Review", exact: true }).click();
  const editor = page.getByRole("region", { name: "Review scanned card" });
  const unsavedName = `My unsaved Ditto ${fixture.suffix}`;
  await editor.getByLabel("Card name", { exact: true }).fill(unsavedName);
  const drafts = await fixture.drafts();
  expect(drafts).toHaveLength(1);
  const draft = drafts[0]!;
  expect((await request.post(`/api/scan-drafts/${draft.id}/discard`, { data: { revision: draft.revision } })).ok()).toBe(true);
  await expect(tile).toHaveCount(0, { timeout: 10_000 });
  await expect(editor.getByText("This scan was discarded. Your entries remain visible here, but it can no longer be saved.", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("Card name", { exact: true })).toHaveValue(unsavedName);
  await expect(editor.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Save to collection", exact: true })).toBeDisabled();
});

test("a failed automatic commit waits for a manual retry", async ({ page, scan }) => {
  const fixture = await scan([{ name: "Retry Raichu" }]);
  let attempts = 0;
  await page.route("**/api/scan-drafts/*/commit", async (route) => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, json: { error: "Temporary test storage failure" } });
    else await route.fallback();
  });
  await page.goto("/scan");
  await page.locator("input[type=file]").setInputFiles(fixture.photos);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Temporary test storage failure");
  await page.waitForResponse((response) => new URL(response.url()).pathname === "/api/scan-drafts" && response.request().method() === "GET");
  expect(attempts).toBe(1);
  const tile = page.locator("li").filter({ hasText: fixture.name(0) });
  await tile.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(tile.getByRole("link", { name: "Open card" })).toBeVisible();
  expect(attempts).toBe(2);
});
