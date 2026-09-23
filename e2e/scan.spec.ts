import { expect, test } from "@playwright/test";
import { cardPhoto, stubIdentify } from "./helpers";

test("scan mode adds, merges and sets aside cards without intervention", async ({ page }) => {
  await page.goto("/scan");
  await stubIdentify(page, [
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
  await expect(page.getByText("1 extra copy")).toBeVisible();
  await expect(page.getByText("1 need review")).toBeVisible();
  await expect(page.getByText("Only 40% sure this is Scanned Blastoise.")).toBeVisible();

  await page.goto("/collection?q=Scanned");
  await expect(page.getByRole("link", { name: /Scanned Charizard/ })).toBeVisible();
  await expect(page.getByText("×2")).toBeVisible();
  // The uncertain card was not saved.
  await expect(page.getByRole("link", { name: /Scanned Blastoise/ })).toHaveCount(0);
});

test("an upload answer that names no stored photo fails that card in words", async ({ page }) => {
  await page.goto("/scan");
  // This app's server names one stored photo per file it was sent; this stands
  // in for anything between the two that answers 200 without one.
  await page.route("**/api/uploads", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ uploads: [] }) }),
  );
  await page.locator("input[type=file]").setInputFiles([await cardPhoto(page, [120, 90, 30])]);
  await expect(page.getByText("The server did not store the photo. Try this one again.")).toBeVisible();
});
