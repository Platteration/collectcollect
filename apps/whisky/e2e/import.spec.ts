import { expect, test } from "@playwright/test";

const csv = [
  "brand,name,age,strength,size,country,packaging,unopened,qty,paid",
  "Benromach,10 Year Old,10,43,700,Scotland,Boxed,yes,2,42",
  "Redbreast,12 Year Old,12,40,700,Ireland,Tube,yes,1,55",
  ",Nothing to go on,,,,,,,1,10",
].join("\n");

test.describe("importing a spreadsheet", () => {
  test("shows what it understood before anything is written, then writes it", async ({ page }) => {
    await page.goto("/import");
    await page.getByLabel("Or paste it").fill(csv);
    await page.getByRole("button", { name: "See what it says" }).click();

    // Two of three rows are usable; the third has no distillery to file it under.
    await expect(page.getByText("of 3 rows can be read")).toBeVisible();
    await expect(page.getByText("brand").first()).toBeVisible();
    await expect(page.getByText("No bottle name in this row")).toBeVisible();

    await page.getByRole("button", { name: /Import 2 rows/ }).click();
    await expect(page.getByText(/added,/)).toBeVisible();

    await page.getByRole("link", { name: "View bottles" }).click();
    await expect(page.getByRole("link", { name: /Benromach/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Redbreast/ })).toBeVisible();
  });

  test("reads the words a spreadsheet uses for a region and a packaging", async ({ page }) => {
    await page.goto("/collection?q=Redbreast");
    await page.getByRole("link", { name: /Redbreast/ }).click();
    await expect(page.getByText(/12 yo · 40% · Ireland/)).toBeVisible();
    await expect(page.getByText("Sealed · Tube")).toBeVisible();
  });
});
