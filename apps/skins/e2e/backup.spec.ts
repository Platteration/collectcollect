import { expect, test } from "@playwright/test";

/** Add an item through the form and land on its page. */
async function add(page: import("@playwright/test").Page, name: string, fields: Record<string, string> = {}) {
  await page.goto("/add");
  await page.getByLabel("Market hash name").fill(name);
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Add to inventory" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
}

test.describe("backup", () => {
  test("an inventory survives a backup, a restore, and the restore being undone", async ({ page }) => {
    await add(page, "Gamma Case", { "How many": "2" });

    await page.goto("/settings");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download backup" }).click()]);
    const archive = await download.path();
    expect(archive).toBeTruthy();

    // Something to lose, so the restore provably replaced the inventory.
    await add(page, "Horizon Case", { "How many": "1" });
    await page.goto("/inventory?q=Horizon");
    await expect(page.getByRole("link", { name: /Horizon Case/ })).toBeVisible();

    await page.goto("/settings");
    await page.setInputFiles("#restore-archive", archive!);
    // Replacing everything asks first; saying no changes nothing.
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "Restore from backup" }).click();
    await expect(page.getByText(/^Restored \d+ items?/)).toHaveCount(0);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Restore from backup" }).click();
    await expect(page.getByText(/Restored \d+ items?/)).toBeVisible({ timeout: 20_000 });

    await page.goto("/inventory?q=Horizon");
    await expect(page.getByRole("link", { name: /Horizon Case/ })).toHaveCount(0);
    await page.goto("/inventory?q=Gamma");
    await expect(page.getByRole("link", { name: /Gamma Case/ })).toBeVisible();

    // The inventory the restore replaced is listed, and one click brings it back.
    await page.goto("/settings");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Put it back" }).first().click();
    await expect(page.getByText(/Put back \d+ items?/)).toBeVisible({ timeout: 20_000 });
    await page.goto("/inventory?q=Horizon");
    await expect(page.getByRole("link", { name: /Horizon Case/ })).toBeVisible();
  });

  test("restoring something that is not a backup is refused", async ({ page }) => {
    await page.goto("/settings");
    await page.setInputFiles("#restore-archive", { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("this is not a zip file") });
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Restore from backup" }).click();
    await expect(page.getByText(/not a zip archive/)).toBeVisible();
  });

  test("reading files back in asks first", async ({ page }) => {
    const file = {
      name: "0900-spectrum-case.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(['---', 'market_hash_name: "Spectrum Case"', 'category: "case"', "quantity: 7", "---", "", "# Spectrum Case", ""].join("\n")),
    };
    await page.goto("/settings");
    const picker = page.locator('input[type="file"][accept=".md,.zip"]');
    page.once("dialog", (d) => d.dismiss());
    await picker.setInputFiles(file);
    await expect(page.getByText(/came back/)).toHaveCount(0);
    await expect(picker).toHaveValue("");
    await page.goto("/inventory?q=Spectrum");
    await expect(page.getByRole("link", { name: /Spectrum Case/ })).toHaveCount(0);

    await page.goto("/settings");
    page.once("dialog", (d) => d.accept());
    await picker.setInputFiles(file);
    await expect(page.getByText(/1 added/)).toBeVisible();
    await page.goto("/inventory?q=Spectrum");
    await expect(page.getByRole("link", { name: /Spectrum Case/ })).toBeVisible();
  });
});
