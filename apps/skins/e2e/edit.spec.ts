import { expect, test } from "@playwright/test";

async function add(page: import("@playwright/test").Page, name: string, fields: Record<string, string> = {}) {
  await page.goto("/add");
  await page.getByLabel("Market hash name").fill(name);
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Add to inventory" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
}

test.describe("correcting an item", () => {
  test("keeps the form out of the way until it is wanted", async ({ page }) => {
    await add(page, "Kilowatt Case", { "How many": "2" });
    await expect(page.getByLabel("Market hash name")).toHaveCount(0);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByLabel("Market hash name")).toBeVisible();
  });

  test("saves a correction and lets the float reset the wear tier", async ({ page }) => {
    await add(page, "USP-S | Kill Confirmed (Minimal Wear)", { Float: "0.09" });
    await expect(page.getByText(/Minimal Wear · \d+% through/)).toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Float").fill("0.42");
    // The tier follows the float rather than sitting beside it, so it cannot
    // be left saying something the float contradicts.
    await expect(page.getByLabel("Wear tier")).toHaveValue("well_worn");
    await expect(page.getByLabel("Wear tier")).toBeDisabled();
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Well-Worn · \d+% through 0.38–0.45/)).toBeVisible();
    await expect(page.getByText("0.42")).toBeVisible();
  });

  test("reconciles the purchases when the count is changed by hand", async ({ page }) => {
    await add(page, "Horizon Case", { "How many": "2", "Paid, each": "1.00" });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("How many").fill("5");
    await page.getByRole("button", { name: "Save" }).click();

    // The three extra copies came from nowhere, so their cost is unknown
    // rather than assumed to match.
    const purchases = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Left" }) });
    await expect(purchases.getByText("not recorded")).toBeVisible();
    await expect(purchases.getByRole("cell", { name: "$1.00" })).toBeVisible();
  });

  test("asks before destroying a history, and says what goes", async ({ page }) => {
    await add(page, "Prisma Case", { "How many": "1", "Paid, each": "0.50" });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Remove this item" }).click();
    await expect(page.getByText(/every purchase, every sale, and every price ever taken/)).toBeVisible();

    // Backing out leaves it exactly where it was.
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("heading", { name: "Prisma Case" })).toBeVisible();

    await page.getByRole("button", { name: "Remove this item" }).click();
    await page.getByRole("button", { name: "Yes, remove it" }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await page.goto("/inventory?q=Prisma");
    await expect(page.getByText("Nothing matches.")).toBeVisible();
  });
});
