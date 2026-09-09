import { expect, test } from "@playwright/test";

test.describe("taking the collection out as a spreadsheet", () => {
  test("exports the collection and the sales ledger, without handing Excel a formula", async ({ page }) => {
    const created = await page.request.post("/api/cards", {
      data: {
        game: "pokemon",
        name: '=HYPERLINK("http://example.invalid","click me")',
        setName: "Export Set",
        quantity: 2,
        purchasePrice: 10,
        notes: "+1 (555) 0100",
      },
    });
    expect(created.ok()).toBe(true);
    const { card } = (await created.json()) as { card: { id: number } };

    // Every test shares one collection, and a sale left behind would turn up
    // in another test's realized-gain figures, so this card goes at the end.
    try {
      const sold = await page.request.post(`/api/cards/${card.id}/sales`, {
        data: { quantity: 1, unitPrice: 40, fees: 2, venue: "eBay" },
      });
      expect(sold.ok()).toBe(true);

      const collection = await page.request.get("/api/export");
      expect(collection.ok()).toBe(true);
      expect(collection.headers()["content-type"]).toContain("csv");
      const csv = await collection.text();
      expect(csv.split("\r\n")[0]).toContain("id,game,sport,name");
      // A leading = or + would be evaluated by a spreadsheet, so both are
      // quoted out with an apostrophe first.
      expect(csv).toContain("\"'=HYPERLINK");
      expect(csv).toContain("'+1 (555) 0100");
      expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);

      const sales = await page.request.get("/api/export?type=sales");
      expect(sales.ok()).toBe(true);
      const ledger = await sales.text();
      expect(ledger.split("\r\n")[0]).toContain("sale_id,card_id");
      expect(ledger).toContain("eBay");
      // One copy at 40 less 2 in fees, against a 10 basis.
      expect(ledger).toContain(",38,");
      expect(ledger).toContain(",28,");
    } finally {
      // Deleting the card takes its sale with it.
      await page.request.delete(`/api/cards/${card.id}`);
    }
  });
});
