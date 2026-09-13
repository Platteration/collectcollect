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

test("a busy identifier is waited out and the card still lands", async ({ page }) => {
  await page.goto("/scan");
  // The first answer is the throttle's: come back in a second. The scan waits
  // and asks again instead of failing the photo.
  let calls = 0;
  await page.route("**/api/identify", async (route) => {
    calls++;
    if (calls === 1) {
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "1" },
        contentType: "application/json",
        body: JSON.stringify({ error: "Too many identifications; try again in 1s" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        identification: {
          game: "pokemon",
          sport: null,
          name: "Patient Psyduck",
          set_name: "Fossil",
          set_code: null,
          card_number: "53/62",
          year: 1999,
          rarity: "Common",
          variant: null,
          language: "English",
          manufacturer: null,
          subject: "Patient Psyduck",
          grading: { company: null, grade: null, cert_number: null },
          condition_notes: null,
          condition_assessment: null,
          confidence: 0.95,
          alternatives: [],
          search_query: "Patient Psyduck",
        },
      }),
    });
  });
  await page.locator("input[type=file]").setInputFiles([await cardPhoto(page, [120, 180, 60])]);
  await expect(page.getByText("1 added")).toBeVisible({ timeout: 30_000 });
  expect(calls).toBe(2);
  await page.goto("/collection?q=Patient");
  await expect(page.getByRole("link", { name: /Patient Psyduck/ })).toBeVisible();
});
