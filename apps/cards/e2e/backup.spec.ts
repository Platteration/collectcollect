import { expect, test, type Page } from "@playwright/test";
import { addCardByHand } from "./helpers";

test.beforeEach(async ({ page }) => {
  // Saving starts a background price lookup. Provider latency must not decide
  // whether this storage test reaches the real restore exclusion gate.
  await page.route("**/api/cards/*/price", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const response = await page.request.get(route.request().url().replace(/\/price$/, ""));
    const { card } = await response.json();
    const fetchedAt = new Date().toISOString();
    await route.fulfill({ status: 200, json: { card, stored: false, snapshot: {
      id: 0, cardId: card.id, fetchedAt, summary: {
        currency: "USD", fetchedAt, ungraded: null, ungradedSource: null,
        graded: {}, gradedSource: null, estimatedGraded: {}, yourCopyValue: null,
        yourCopyBasis: "No price lookup in backup tests", quotes: [], errors: [],
      },
    } } });
  });
});

async function restoreArchive(page: Page, archive: string) {
  await page.setInputFiles("#restore-archive", archive);
  page.once("dialog", (dialog) => dialog.accept());
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/backup/restore" && response.request().method() === "POST"),
    page.getByRole("button", { name: "Restore from backup" }).click(),
  ]);
  expect(response.ok(), `Restore returned ${response.status()}: ${await response.text()}`).toBe(true);
  await expect(page.getByText(/Restored \d+ cards? and \d+ photos?/)).toBeVisible({ timeout: 20_000 });
}

test("a collection survives a backup and restore", async ({ page }, testInfo) => {
  const suffix = `${testInfo.repeatEachIndex}-${testInfo.retry}`;
  const original = `Roundtrip Snorlax ${suffix}`, later = `Added After Backup ${suffix}`;
  await addCardByHand(page, { name: original, set: "Jungle" });

  // Take the backup.
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download backup" }).click()]);
  const archive = await download.path();
  expect(archive).toBeTruthy();

  // Change the collection so the restore has something to undo.
  await addCardByHand(page, { name: later, set: "Jungle" });
  await page.goto(`/collection?${new URLSearchParams({ q: later })}`);
  await expect(page.getByRole("link", { name: new RegExp(later) })).toBeVisible();

  // Put the backup back.
  await page.goto("/settings");
  await restoreArchive(page, archive!);

  // The card from the backup is back, and the later one is gone.
  await page.goto(`/collection?${new URLSearchParams({ q: original })}`);
  await expect(page.getByRole("link", { name: new RegExp(original) })).toBeVisible();
  await page.goto(`/collection?${new URLSearchParams({ q: later })}`);
  await expect(page.getByRole("link", { name: new RegExp(later) })).toHaveCount(0);
});

test("a restore can be undone from Settings", async ({ page }, testInfo) => {
  const suffix = `${testInfo.repeatEachIndex}-${testInfo.retry}`;
  const original = `Kept Through A Restore ${suffix}`, later = `Lost To The Restore ${suffix}`;
  await addCardByHand(page, { name: original, set: "Jungle" });
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download backup" }).click()]);
  const archive = await download.path();

  await addCardByHand(page, { name: later, set: "Jungle" });
  await page.goto("/settings");
  await restoreArchive(page, archive!);
  await page.goto(`/collection?${new URLSearchParams({ q: later })}`);
  await expect(page.getByRole("link", { name: new RegExp(later) })).toHaveCount(0);

  // The collection the restore replaced is listed, and one click brings it back.
  await page.goto("/settings");
  const replaced = page.getByRole("button", { name: "Put it back" });
  await expect(replaced.first()).toBeVisible();
  page.once("dialog", (d) => d.accept());
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/backup/replaced" && response.request().method() === "POST"),
    replaced.first().click(),
  ]);
  expect(response.ok(), `Put-back returned ${response.status()}: ${await response.text()}`).toBe(true);
  await expect(page.getByText(/Put back \d+ cards? and \d+ photos?/)).toBeVisible({ timeout: 20_000 });
  await page.goto(`/collection?${new URLSearchParams({ q: later })}`);
  await expect(page.getByRole("link", { name: new RegExp(later) })).toBeVisible();
});

test("restoring something that is not a backup is refused", async ({ page }) => {
  await page.goto("/settings");
  await page.setInputFiles("#restore-archive", { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("this is not a zip file") });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Restore from backup" }).click();
  await expect(page.getByText(/not a zip archive/)).toBeVisible();
});
