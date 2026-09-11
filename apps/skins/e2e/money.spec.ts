import { expect, test } from "@playwright/test";

/** Add an item through the form and land on its page. */
async function add(page: import("@playwright/test").Page, name: string, fields: Record<string, string> = {}) {
  await page.goto("/add");
  await page.getByLabel("Market hash name").fill(name);
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Add to inventory" }).click();
  await expect(page).toHaveURL(/\/items\/\d+$/);
}

test.describe("money", () => {
  test("a sale takes the copies and books the gain against what they cost", async ({ page }) => {
    await add(page, "Revolution Case", { "How many": "5", "Paid, each": "1.00" });

    await page.getByRole("button", { name: "Sold some" }).click();
    await page.getByLabel("How many").last().fill("2");
    await page.getByLabel("Sold for, each").fill("3.00");
    await page.getByLabel("Fees").fill("0.60");
    await page.getByRole("button", { name: "Record the sale" }).click();

    // Two copies gone, three left. $6.00 less $0.60 of fees less the $2.00 they
    // cost is $3.40 — measured against those copies, not against the market.
    await expect(page.getByRole("cell", { name: "$3.40" })).toBeVisible();
    const purchases = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Left" }) });
    await expect(purchases.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  });

  test("sells the oldest copies first, at what those copies cost", async ({ page }) => {
    await add(page, "Snakebite Case", { "How many": "1", "Paid, each": "1.00" });

    await page.getByRole("button", { name: "Bought more" }).click();
    await page.getByLabel("How many").last().fill("1");
    await page.getByLabel("Cost each").fill("9.00");
    await page.getByRole("button", { name: "Record the purchase" }).click();
    await expect(page.getByRole("cell", { name: "$9.00" })).toBeVisible();

    await page.getByRole("button", { name: "Sold some" }).click();
    await page.getByLabel("Sold for, each").fill("10.00");
    await page.getByRole("button", { name: "Record the sale" }).click();

    // The dollar copy went, not the nine-dollar one, so the sale cost $1.
    const sales = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Gain" }) });
    await expect(sales.getByRole("cell", { name: "$1.00" })).toBeVisible();
    await expect(sales.getByRole("cell", { name: "$9.00" })).toBeVisible();
  });

  test("undoing a sale puts the copies back where they came from", async ({ page }) => {
    await add(page, "Fracture Case", { "How many": "2", "Paid, each": "2.50" });

    await page.getByRole("button", { name: "Sold some" }).click();
    await page.getByLabel("How many").last().fill("2");
    await page.getByLabel("Sold for, each").fill("4.00");
    await page.getByRole("button", { name: "Record the sale" }).click();
    await expect(page.getByRole("button", { name: "All sold" })).toBeVisible();

    // Undoing money that changed hands asks first; saying no changes nothing.
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("row", { name: /\$4\.00/ }).getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "All sold" })).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("row", { name: /\$4\.00/ }).getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Sold some" })).toBeEnabled();
    // Both copies back, still at what they cost.
    await expect(page.getByText(/paid \$2\.50/)).toBeVisible();
  });

  test("undoing a purchase asks first and takes the copies with it", async ({ page }) => {
    await add(page, "Prisma Case", { "How many": "1", "Paid, each": "1.00" });
    await page.getByRole("button", { name: "Bought more" }).click();
    await page.getByLabel("How many").last().fill("3");
    await page.getByLabel("Cost each").fill("2.00");
    await page.getByRole("button", { name: "Record the purchase" }).click();
    const purchases = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Left" }) });
    await expect(purchases.getByRole("cell", { name: "$2.00" })).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await purchases.getByRole("row", { name: /\$2\.00/ }).getByRole("button", { name: "Undo" }).click();
    await expect(purchases.getByRole("cell", { name: "$2.00" })).toHaveCount(0);
    await expect(page.getByText(/paid \$1\.00/)).toBeVisible();
  });

  test("will not book a sale with no price", async ({ page }) => {
    await add(page, "Dreams & Nightmares Case", { "How many": "1", "Paid, each": "1.00" });
    await page.getByRole("button", { name: "Sold some" }).click();
    // An empty box reaching the server as zero would book a free sale and take
    // the copy with it.
    await expect(page.getByRole("button", { name: "Record the sale" })).toBeDisabled();
  });

  test("refuses to undo a purchase that has been sold from", async ({ page }) => {
    await add(page, "Recoil Case", { "How many": "2", "Paid, each": "1.00" });
    await page.getByRole("button", { name: "Sold some" }).click();
    await page.getByLabel("Sold for, each").fill("2.00");
    await page.getByRole("button", { name: "Record the sale" }).click();

    // Removing it would rewrite money that has already changed hands.
    const purchases = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Left" }) });
    await expect(purchases.getByText("sold from")).toBeVisible();
    await expect(purchases.getByRole("button", { name: "Undo" })).toHaveCount(0);
  });

  test("a unique object is sold once and keeps its history", async ({ page }) => {
    await add(page, "Glock-18 | Fade (Factory New)", { Float: "0.01", "Paid, each": "400" });
    // One object, so no count to choose.
    await page.getByRole("button", { name: "Sold some" }).click();
    await expect(page.getByLabel("How many")).toHaveCount(0);
    await page.getByLabel("Sold for, each").fill("650");
    await page.getByRole("button", { name: "Record the sale" }).click();

    await expect(page.getByRole("button", { name: "All sold" })).toBeVisible();
    // The row stays, and so does what it cost.
    await expect(page.getByText(/paid \$400\.00/)).toBeVisible();
  });
});
