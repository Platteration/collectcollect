import { expect, test } from "@playwright/test";
import { addCardByHand } from "./helpers";

test("a collection survives a backup and restore", async ({ page }) => {
  await addCardByHand(page, { name: "Roundtrip Snorlax", set: "Jungle" });

  // Take the backup.
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download backup" }).click()]);
  const archive = await download.path();
  expect(archive).toBeTruthy();

  // Change the collection so the restore has something to undo.
  await addCardByHand(page, { name: "Added After Backup", set: "Jungle" });
  await page.goto("/collection?q=Added+After");
  await expect(page.getByRole("link", { name: /Added After Backup/ })).toBeVisible();

  // Put the backup back.
  await page.goto("/settings");
  await page.setInputFiles("#restore-archive", archive!);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Restore from backup" }).click();
  await expect(page.getByText(/Restored \d+ cards? and \d+ photos?/)).toBeVisible({ timeout: 20_000 });

  // The card from the backup is back, and the later one is gone.
  await page.goto("/collection?q=Roundtrip");
  await expect(page.getByRole("link", { name: /Roundtrip Snorlax/ })).toBeVisible();
  await page.goto("/collection?q=Added+After");
  await expect(page.getByRole("link", { name: /Added After Backup/ })).toHaveCount(0);
});

test("a restore can be undone from Settings", async ({ page }) => {
  await addCardByHand(page, { name: "Kept Through A Restore", set: "Jungle" });
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download backup" }).click()]);
  const archive = await download.path();

  await addCardByHand(page, { name: "Lost To The Restore", set: "Jungle" });
  await page.goto("/settings");
  await page.setInputFiles("#restore-archive", archive!);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Restore from backup" }).click();
  await expect(page.getByText(/Restored \d+ cards? and \d+ photos?/)).toBeVisible({ timeout: 20_000 });
  await page.goto("/collection?q=Lost+To");
  await expect(page.getByRole("link", { name: /Lost To The Restore/ })).toHaveCount(0);

  // The collection the restore replaced is listed, and one click brings it back.
  await page.goto("/settings");
  const replaced = page.getByRole("button", { name: "Put it back" });
  await expect(replaced.first()).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await replaced.first().click();
  await expect(page.getByText(/Put back \d+ cards? and \d+ photos?/)).toBeVisible({ timeout: 20_000 });
  await page.goto("/collection?q=Lost+To");
  await expect(page.getByRole("link", { name: /Lost To The Restore/ })).toBeVisible();
});

test("restoring something that is not a backup is refused", async ({ page }) => {
  await page.goto("/settings");
  await page.setInputFiles("#restore-archive", { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("this is not a zip file") });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Restore from backup" }).click();
  await expect(page.getByText(/not a zip archive/)).toBeVisible();
});
