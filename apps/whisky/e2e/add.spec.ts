import { expect, test, type Page } from "@playwright/test";

test.describe("adding a bottle by hand", () => {
  test("saves what was typed and opens it", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Distillery / brand").fill("GlenDronach");
    await page.getByLabel("Expression").fill("15 Year Old Revival");
    await page.getByLabel("Age statement, years").fill("15");
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Paid, each (USD)").fill("90");
    await page.getByRole("button", { name: "Save bottle" }).click();

    await expect(page.getByText(/Saved GlenDronach to your bottles/)).toBeVisible();
    await page.getByRole("link", { name: "Open it" }).click();
    await expect(page.getByRole("heading", { name: "GlenDronach 15 Year Old Revival" })).toBeVisible();
    await expect(page.getByText("×2")).toBeVisible();
    await expect(page.getByText(/paid \$90\.00 each/)).toBeVisible();
    // A bottle arrives sealed unless said otherwise, and sealed bottles stack.
    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
  });

  test("takes a second identical bottle as another copy rather than a second row", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Distillery / brand").fill("Highland Park");
    await page.getByLabel("Expression").fill("12 Year Old Viking Honour");
    await page.getByRole("button", { name: "Save bottle" }).click();
    await expect(page.getByText(/Saved Highland Park to your bottles/)).toBeVisible();

    await page.goto("/add");
    await page.getByLabel("Distillery / brand").fill("Highland Park");
    await page.getByLabel("Expression").fill("12 Year Old Viking Honour");
    await page.getByRole("button", { name: "Save bottle" }).click();
    await expect(page.getByText(/Added as another copy of Highland Park/)).toBeVisible();
  });

  test("refuses a bottle with no expression rather than saving half of one", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Distillery / brand").fill("Nameless");
    await page.getByRole("button", { name: "Save bottle" }).click();
    await expect(page.getByText(/Expression is required/)).toBeVisible();
  });
});

test.describe("adding photos to a bottle", () => {
  /** A photo made in the browser, so the test needs no binary fixture. */
  const photo = async (page: Page, name: string, shade: number) => {
    const dataUrl = await page.evaluate((v) => {
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 160;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.8);
    }, shade);
    return { name, mimeType: "image/jpeg", buffer: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64") };
  };

  test("keeps the picture Take photo brings back, and as many as Choose photos is given", async ({ page }) => {
    await page.goto("/add");
    const saved = page.locator("img[src^='/api/uploads/']");
    await expect(saved).toHaveCount(0);

    await page.locator("input[type=file][capture]").setInputFiles(await photo(page, "shot.jpg", 60));
    await expect(saved).toHaveCount(1);

    // The gallery's input takes several at once; a fourth picture is the last the page keeps.
    await page.locator("input[type=file]:not([capture])").setInputFiles([await photo(page, "a.jpg", 110), await photo(page, "b.jpg", 160)]);
    await expect(saved).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Take photo" })).toBeEnabled();
    await page.locator("input[type=file]:not([capture])").setInputFiles([await photo(page, "c.jpg", 200), await photo(page, "d.jpg", 230)]);
    await expect(saved).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Take photo" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Choose photos" })).toBeDisabled();
  });
});
