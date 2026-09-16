import { expect, test } from "@playwright/test";
import { cardPhoto } from "./helpers";
import { stubScans } from "./scan-fixture";

test("scan mode adds, merges and sets aside cards without intervention", async ({ page }) => {
  await page.goto("/scan");
  await stubScans(page, [
    { name: "Scanned Charizard", card_number: "4/102" },
    { name: "Scanned Pikachu", set_name: "Jungle", card_number: "60/64" },
    // the same card again: it must merge rather than create a second row
    { name: "Scanned Charizard", card_number: "4/102" },
    // too uncertain to save unattended
    { name: "Scanned Blastoise", card_number: "2/102", confidence: 0.4 },
  ]);

  const photos = await Promise.all(
    ([[200, 60, 60], [60, 200, 60], [60, 60, 200], [200, 200, 60]] as Array<[number, number, number]>).map((rgb) => cardPhoto(page, rgb)),
  );
  await page.locator("input[type=file]").setInputFiles(photos);

  await expect(page.getByText("2 added")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1 extra copies")).toBeVisible();
  await expect(page.getByText("1 need review")).toBeVisible();
  await expect(page.getByText("Only 40% sure this is Scanned Blastoise.")).toBeVisible();

  await page.goto("/collection?q=Scanned");
  await expect(page.getByRole("link", { name: /Scanned Charizard/ })).toBeVisible();
  await expect(page.getByText("×2")).toBeVisible();
  // The uncertain card was not saved.
  await expect(page.getByRole("link", { name: /Scanned Blastoise/ })).toHaveCount(0);
});

test("a busy identifier is waited out and the card still lands", async ({ page }) => {
  await page.goto("/scan");
  await stubScans(page, [{ name: "Patient Psyduck", set_name: "Fossil", card_number: "53/62" }], true);
  await page.locator("input[type=file]").setInputFiles([await cardPhoto(page, [120, 180, 60])]);
  await expect(page.locator("li").filter({ hasText: "Patient Psyduck" }).getByRole("link", { name: "Open card" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/collection?q=Patient");
  await expect(page.getByRole("link", { name: /Patient Psyduck/ })).toBeVisible();
});

test("uncertain scans survive reload and save from the existing photo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/scan");
  await stubScans(page, [{ name: "Resume Snorlax", confidence: 0.3 }]);
  await page.locator("input[type=file]").setInputFiles([await cardPhoto(page, [120, 40, 80])]);
  await expect(page.getByText("Only 30% sure this is Resume Snorlax.")).toBeVisible();
  await page.reload();
  await page.locator("li").filter({ hasText: "Resume Snorlax" }).getByRole("button", { name: "Review", exact: true }).click();
  const editor = page.getByRole("region", { name: "Review scanned card" });
  await editor.getByLabel("Card name", { exact: true }).fill("Reviewed Snorlax");
  await editor.getByLabel("Add back or label photo").setInputFiles([await cardPhoto(page, [10, 30, 60])]);
  await expect(editor.getByText("2 saved photos", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.reload();
  await page.locator("li").filter({ hasText: "Reviewed Snorlax" }).getByRole("button", { name: "Review", exact: true }).click();
  await expect(editor.getByRole("img", { name: "Saved photo 2" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/scan-review-mobile.png", fullPage: true });
  await page.getByRole("region", { name: "Review scanned card" }).getByRole("button", { name: "Save to collection" }).click();
  await expect(page.locator("li").filter({ hasText: "Reviewed Snorlax" }).getByRole("link", { name: "Open card" })).toBeVisible();
  await page.goto("/collection?q=Reviewed+Snorlax");
  await expect(page.getByRole("link", { name: /Reviewed Snorlax/ })).toHaveCount(1);
});

test("polling preserves local edits and a stale save cannot overwrite another tab", async ({ page, request }) => {
  await page.goto("/scan");
  await stubScans(page, [{ name: "Two tabs Eevee", confidence: 0.2 }]);
  await page.locator("input[type=file]").setInputFiles([await cardPhoto(page, [90, 70, 30])]);
  await expect(page.getByText("Only 20% sure this is Two tabs Eevee.")).toBeVisible();
  await page.locator("li").filter({ hasText: "Two tabs Eevee" }).getByRole("button", { name: "Review", exact: true }).click();
  const editor = page.getByRole("region", { name: "Review scanned card" });
  await editor.getByLabel("Card name", { exact: true }).fill("Unsaved local Eevee");
  const listed = await (await request.get("/api/scan-drafts")).json() as { drafts: Array<{ id: string; revision: number; input: { name?: string } }> };
  const draft = listed.drafts.find((d) => d.input.name === "Two tabs Eevee")!;
  const response = await request.patch(`/api/scan-drafts/${draft.id}`, { data: { revision: draft.revision, input: { name: "Saved in other tab" } } });
  expect(response.ok()).toBe(true);
  await expect(editor.getByText(/Your unsaved edits are still here/)).toBeVisible({ timeout: 10_000 });
  await expect(editor.getByLabel("Card name", { exact: true })).toHaveValue("Unsaved local Eevee");
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("changed in another tab");
  await expect(editor.getByLabel("Card name", { exact: true })).toHaveValue("Unsaved local Eevee");
  await editor.getByRole("button", { name: "Reload and discard my edits" }).click();
  await expect(editor.getByLabel("Card name", { exact: true })).toHaveValue("Saved in other tab");
});
