import { expect, test } from "@playwright/test";

const CSV = [
  "name,float,seed,cost,storage",
  "M4A4 | Howl (Field-Tested),0.2401,55,1850,Backpack",
  "Gamma 2 Case,,,0.35,",
  ",,,99,",
  "Mystery Object,,,5,",
].join("\n");

test.describe("importing a spreadsheet", () => {
  test("shows what it understood before writing anything", async ({ page }) => {
    await page.goto("/import");
    await page.getByLabel("Or paste it").fill(CSV);
    await page.getByRole("button", { name: "See what it says" }).click();

    await expect(page.getByText(/2 of 4 rows can be read/)).toBeVisible();
    await expect(page.getByText(/2 row\(s\) that cannot be imported/)).toBeVisible();
    await expect(page.getByText(/Line 4: No item name in this row/)).toBeVisible();
    await expect(page.getByText(/Line 5:.*what kind of item/)).toBeVisible();

    // Nothing is in the inventory until the second button.
    await page.goto("/inventory?q=Howl");
    await expect(page.getByText("Nothing matches.")).toBeVisible();
  });

  test("imports the rows it could read and reports the rest", async ({ page }) => {
    await page.goto("/import");
    await page.getByLabel("Or paste it").fill(CSV);
    await page.getByRole("button", { name: "See what it says" }).click();
    await page.getByRole("button", { name: /Import 2 rows/ }).click();

    await expect(page.getByText(/2 added/)).toBeVisible();
    await expect(page.getByText(/Line 4: No item name in this row/)).toBeVisible();

    await page.goto("/inventory?q=Howl");
    await page.getByRole("link", { name: /M4A4 \| Howl/ }).click();
    await expect(page.getByText("0.2401")).toBeVisible();
    await expect(page.getByText(/Pattern 55/)).toBeVisible();
    await expect(page.getByText(/paid \$1,850\.00/)).toBeVisible();
    await expect(page.getByText("Backpack")).toBeVisible();
    // Field-Tested was never in a column; it came out of the float.
    await expect(page.getByText(/Field-Tested · \d+% through 0.15–0.38/)).toBeVisible();
  });

  test("joins a stack already held rather than making a second row", async ({ page }) => {
    await page.goto("/import");
    await page.getByLabel("Or paste it").fill("name,qty,cost\nGamma 3 Case,4,0.20");
    await page.getByRole("button", { name: "See what it says" }).click();
    await page.getByRole("button", { name: /Import 1 row/ }).click();
    await expect(page.getByText(/1 added/)).toBeVisible();

    await page.goto("/import");
    await page.getByLabel("Or paste it").fill("name,qty,cost\nGamma 3 Case,6,0.90");
    await page.getByRole("button", { name: "See what it says" }).click();
    await page.getByRole("button", { name: /Import 1 row/ }).click();
    await expect(page.getByText(/1 joined something already held/)).toBeVisible();

    await page.goto("/inventory?q=Gamma 3");
    await page.getByRole("link", { name: /Gamma 3 Case/ }).click();
    // Ten copies from two purchases, each still at its own price.
    await expect(page.getByRole("cell", { name: "$0.20" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$0.90" })).toBeVisible();
    await expect(page.getByText(/paid \$0\.62/)).toBeVisible();
  });
});

test.describe("importing from Steam", () => {
  test("importing the same file twice does not double the stack", async ({ page }) => {
    const csv = "name,qty,cost\nDanger Zone Case,4,0.10";
    const previewed = await page.request.post("/api/import", { data: { csv } });
    expect(previewed.ok()).toBe(true);
    const { preview } = (await previewed.json()) as { preview: { token: string } };
    const applied = await page.request.post("/api/import", { data: { csv, apply: true, token: preview.token } });
    expect(applied.ok()).toBe(true);
    // The retry a flaky connection or a double click would send.
    const again = await page.request.post("/api/import", { data: { csv, apply: true, token: preview.token } });
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/imported a moment ago/);

    await page.goto("/inventory?q=Danger%20Zone");
    await expect(page.getByRole("link", { name: /Danger Zone Case/ })).toHaveCount(1);
    await page.getByRole("link", { name: /Danger Zone Case/ }).click();
    const purchases = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Left" }) });
    await expect(purchases.getByRole("cell", { name: "4", exact: true }).first()).toBeVisible();
  });

  test("will not send anything that is not a SteamID64", async ({ page }) => {
    await page.goto("/import");
    const read = page.getByRole("button", { name: "See what is there" });
    await expect(read).toBeDisabled();
    await page.getByLabel("SteamID64").fill("hello");
    await expect(read).toBeDisabled();
    await page.getByLabel("SteamID64").fill("76561198000000001");
    await expect(read).toBeEnabled();
  });

  test("says what an import will and will not bring with it", async ({ page }) => {
    await page.goto("/import");
    await expect(page.getByText(/knows what you paid/)).toBeVisible();
  });
});
