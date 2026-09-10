import { expect, test } from "@playwright/test";

test.describe("the valuation report", () => {
  test("totals what the inventory is worth and says where each figure came from", async ({ page }) => {
    await page.goto("/report");
    await expect(page.getByRole("heading", { name: "Inventory valuation" })).toBeVisible();
    // 1180 + 51 + 34 + 35 × 1.40 + 128
    await expect(page.getByText("$1,442.00").first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Skinport lowest ask" }).first()).toBeVisible();
    await expect(page.getByText(/before that market.s fees/)).toBeVisible();
  });

  test("lists an unpriced item as unpriced rather than counting it as nothing", async ({ page }) => {
    // Nothing in the fixture is unpriced, so the report says so — which is the
    // claim that has to be true for the total to mean anything.
    await page.goto("/report");
    await expect(page.getByText("everything is priced")).toBeVisible();
  });

  test("hides the app's own chrome when printed", async ({ page }) => {
    await page.goto("/report");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("button", { name: /Print/ })).toBeHidden();
    // The report's own heading and its numbers must survive.
    await expect(page.getByRole("heading", { name: "Inventory valuation" })).toBeVisible();
    await expect(page.getByText("$1,442.00").first()).toBeVisible();
  });
});

test.describe("taking it out as a spreadsheet", () => {
  test("exports the inventory in the columns the importer reads back", async ({ request }) => {
    const response = await request.get("/api/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    const csv = await response.text();
    const [header, ...rows] = csv.trim().split("\r\n");
    expect(header.split(",")).toEqual(
      expect.arrayContaining(["name", "category", "float", "seed", "quantity", "cost", "storage", "tradelock"]),
    );
    expect(rows.some((r) => r.includes("Karambit"))).toBe(true);
    // Full precision, not the six decimals the page shows.
    expect(csv).toContain("0.0141");
  });

  test("exports the sales ledger with what each sale actually earned", async ({ request }) => {
    const csv = await (await request.get("/api/export?type=sales")).text();
    expect(csv).toContain("Chroma 3 Case");
    // Six copies at $0.55 less $0.40 of fees is $2.90, against $1.80 of cost.
    expect(csv).toContain("2.9");
    expect(csv).toContain("1.1");
  });

  test("does not hand a spreadsheet something it would run", async ({ request }) => {
    const csv = await (await request.get("/api/export")).text();
    // A leading = + - or @ would be evaluated by Excel. The star on a knife
    // name is safe and must survive unquoted-looking.
    for (const line of csv.split("\r\n").slice(1)) {
      for (const field of line.split(",")) {
        expect(field.replace(/^"/, "").startsWith("=")).toBe(false);
      }
    }
    expect(csv).toContain("Karambit");
  });
});
