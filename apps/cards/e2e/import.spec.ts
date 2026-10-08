import { expect, test } from "@playwright/test";

const CSV = [
  "Card Name,Game,Edition,Card Number,Qty,Cond,Price Paid,Sleeved",
  'Imported Charizard,Pokemon,Base Set,4/102,1,NM,"$400.00",yes',
  "Imported Dark Magician,Yu-Gi-Oh!,LOB,LOB-005,2,Lightly Played,55,no",
  ",Pokemon,Base Set,,1,NM,,no",
].join("\r\n");

test("a spreadsheet from another tool imports after a preview", async ({ page }) => {
  await page.goto("/import");
  await page.setInputFiles("input[type=file]", { name: "collection.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });

  // The preview explains the mapping and flags the unusable row before writing.
  await expect(page.getByText("2 of 3 rows ready")).toBeVisible();
  await expect(page.getByText(/Card Name → name/)).toBeVisible();
  await expect(page.getByText(/Ignored: Sleeved/)).toBeVisible();
  await expect(page.getByText("No card name in this row")).toBeVisible();
  await expect(page.getByText("$400.00")).toBeVisible();

  await page.getByRole("button", { name: /Import 2 cards/ }).click();
  await expect(page.getByText("2 cards added, 0 merged into cards you already had, 1 skipped.")).toBeVisible();

  await page.goto("/collection?q=Imported");
  await expect(page.getByRole("link", { name: /Imported Charizard/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Imported Dark Magician/ })).toBeVisible();
  await expect(page.getByText("×2")).toBeVisible();

  // Re-importing the same file merges rather than duplicating.
  await page.goto("/import");
  await page.setInputFiles("input[type=file]", { name: "collection.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.getByRole("button", { name: /Import 2 cards/ }).click();
  await expect(page.getByText("0 cards added, 2 merged into cards you already had, 1 skipped.")).toBeVisible();
});
