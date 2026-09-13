import { expect, test } from "@playwright/test";
import { addCardByHand, cardPhoto } from "./helpers";

test("a photo can be added to a card later, replaced, and removed", async ({ page }) => {
  await addCardByHand(page, { name: "Pictured Pidgeot", set: "Jungle" });
  await page.goto("/collection?q=Pictured");
  await page.getByRole("link", { name: /Pictured Pidgeot/ }).click();
  await expect(page.getByText("No image")).toBeVisible();

  await page.setInputFiles("#card-photo", await cardPhoto(page, [200, 80, 80]));
  await expect(page.getByRole("status").filter({ hasText: "Photo added." })).toBeVisible();
  const photo = page.locator("img[src^='/api/uploads/']").first();
  await expect(photo).toBeVisible();
  const firstSrc = await photo.getAttribute("src");

  // A better shot replaces it, under a new name.
  await page.setInputFiles("#card-photo", await cardPhoto(page, [80, 80, 200]));
  await expect(page.getByRole("status").filter({ hasText: "Photo replaced." })).toBeVisible();
  await expect(photo).not.toHaveAttribute("src", firstSrc!);
  // The old file is gone from the server.
  expect((await page.request.get(firstSrc!)).status()).toBe(404);

  // Saying no keeps it; saying yes takes only the picture.
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(photo).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByText("No image")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pictured Pidgeot" })).toBeVisible();
});
