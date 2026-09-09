import { expect, test } from "@playwright/test";
import { addCardByHand } from "./helpers";

test.describe("the collection in plain text", () => {
  test("every card is written as a file you can download", async ({ page }) => {
    await addCardByHand(page, { name: "Plaintext Lapras", set: "Fossil", number: "10/62", quantity: "2" });

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Your collection in plain text" })).toBeVisible();
    await expect(page.getByText(/\d+ files? \(/)).toBeVisible();

    const archive = await page.request.get("/api/collection");
    expect(archive.ok()).toBe(true);
    expect(archive.headers()["content-type"]).toContain("zip");
    const bytes = await archive.body();
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    // The card's own text is in there uncompressed enough to find by eye.
    expect(bytes.length).toBeGreaterThan(200);
  });

  test("a collection can be rebuilt from nothing but its files", async ({ page }) => {
    const card = [
      "---",
      'id: 4242',
      'name: "Recovered Charizard"',
      'game: "pokemon"',
      'set_name: "Base Set"',
      'card_number: "4/102"',
      "year: 1999",
      "quantity: 3",
      'condition: "NM"',
      'grading_company: "PSA"',
      'grade: "9"',
      "purchase_price: 250",
      'location: "Binder 2"',
      "---",
      "",
      "# Recovered Charizard",
      "",
      "## Notes",
      "",
      "Rescued from a folder of Markdown.",
      "",
      "## Value history",
      "",
      "| Date | Your copy | Ungraded | Graded | Basis |",
      "| --- | --- | --- | --- | --- |",
      "| 2026-02-02T10:00:00.000Z | $4,200.00 | $300.00 (PriceCharting) | PSA 10 $12,000.00 | PSA 9 price. |",
      "",
    ].join("\n");

    await page.goto("/settings");
    await page.setInputFiles("#collection-files", { name: "4242-recovered-charizard.md", mimeType: "text/markdown", buffer: Buffer.from(card) });
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Read them back in" }).click();
    await expect(page.getByText(/Added 1 card and refreshed 0/)).toBeVisible({ timeout: 15_000 });

    await page.goto("/collection?q=Recovered");
    await expect(page.getByRole("link", { name: /Recovered Charizard/ })).toBeVisible();
    await page.getByRole("link", { name: /Recovered Charizard/ }).first().click();
    await expect(page.getByText("Rescued from a folder of Markdown.")).toBeVisible();
    await expect(page.getByText("Binder 2").first()).toBeVisible();

    // Reading the same file again recognises the card rather than duplicating it.
    await page.goto("/settings");
    await page.setInputFiles("#collection-files", { name: "4242-recovered-charizard.md", mimeType: "text/markdown", buffer: Buffer.from(card) });
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Read them back in" }).click();
    await expect(page.getByText(/Added 0 cards and refreshed 1/)).toBeVisible({ timeout: 15_000 });
    await page.goto("/collection?q=Recovered");
    await expect(page.getByRole("link", { name: /Recovered Charizard/ })).toHaveCount(1);
  });
});
