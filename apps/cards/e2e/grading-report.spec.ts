import { expect, test, type Page } from "@playwright/test";

async function create(page: Page, data: Record<string, unknown>): Promise<number> {
  const res = await page.request.post("/api/cards", { data: { game: "pokemon", setName: "Report Set", ...data } });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { card: { id: number } }).card.id;
}

test.describe("centering and the grading report", () => {
  test("a raw card says how far its centering lets it grade, and the outlook is capped there", async ({ page }) => {
    // A manual price is the only source here, so the outlook is all estimates:
    // PSA 10 at 300, PSA 9 at 140, PSA 8 at 100 from the default multipliers.
    // A reference image, so the 3D view draws the print this test measures the shift of.
    const id = await create(page, { name: "Off-centre Onix", manualUngraded: 100, referenceImageUrl: "https://example.invalid/onix.jpg", centering: { front: { lr: "60/40", tb: "52/48" } } });
    try {
      expect((await page.request.post(`/api/cards/${id}/price`, { data: {} })).ok()).toBe(true);
      await page.goto(`/cards/${id}`);
      await expect(page.getByText("60/40 left-right · 52/48 top-bottom")).toBeVisible();
      await expect(page.getByTestId("centering-caps")).toContainText("Centering allows up to PSA 9 · BGS 9 · CGC 9 · SGC 9 · TAG 9 · ACE 10.");
      // The best case is the 9, said so, and priced at the 9's estimate.
      await expect(page.getByText("PSA 9 (max, capped by centering)")).toBeVisible();
      await expect(page.getByText(/front 60\/40 left-right is as far off as PSA/)).toBeVisible();
      await expect(page.getByText(/Best case capped at PSA 9 by the measured centering/)).toBeVisible();
      // The measured centering shifts the print in the 3D view: 10 points off is 3%.
      await expect(page.locator(".card3d-art").first()).toHaveAttribute("style", /translate\(3\.00%, 0\.60%\)/);
    } finally {
      await page.request.delete(`/api/cards/${id}`);
    }
  });

  test("the centering fields on the form read back what was measured and refuse what is not a ratio", async ({ page }) => {
    const id = await create(page, { name: "Measured Machop", centering: { front: { lr: "55/45" } } });
    try {
      await page.goto(`/cards/${id}`);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.getByLabel("Front centering (left/right)")).toHaveValue("55/45");
      await page.getByLabel("Front centering (top/bottom)").fill("60/45");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "add up to 100" })).toContainText("add up to 100, like 55/45");
      await page.getByLabel("Front centering (top/bottom)").fill("52/48");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("55/45 left-right · 52/48 top-bottom")).toBeVisible();
    } finally {
      await page.request.delete(`/api/cards/${id}`);
    }
  });
});

test.describe("the grading report on a slab", () => {
  test("a TAG card shows its report, score and centering, and links to the DIG report", async ({ page }) => {
    const id = await create(page, {
      name: "Reported Rayquaza",
      gradingCompany: "TAG",
      grade: "10",
      certNumber: "A1234567",
      centering: { front: "54L/46R 49T/51B", back: "45L/55R" },
      gradingReport: {
        company: "TAG",
        cert: "A1234567",
        source: "manual",
        checkedAt: "2026-10-01T00:00:00.000Z",
        grade: "10",
        label: "Pristine",
        tag: { score: 973, rollups: { centering: 990, corners: 960, edges: 970, surface: 980 }, composite: { front: 975, back: 970 } },
        population: { atGrade: 12, total: 40, higher: 3 },
      },
    });
    try {
      await page.goto(`/cards/${id}`);
      const report = page.getByTestId("grading-report");
      await expect(report.getByRole("heading", { name: /TAG grading report/ })).toBeVisible();
      const link = report.getByRole("link", { name: "View the DIG report on TAG" });
      await expect(link).toHaveAttribute("href", "https://my.taggrading.com/card/A1234567");
      await expect(link).toHaveAttribute("rel", "noreferrer");
      await expect(report).toContainText("Pristine label · grade 10");
      await expect(report).toContainText("TAG score 973");
      await expect(report).toContainText("centering 990, corners 960, edges 970, surface 980");
      await expect(report).toContainText("Population 12 at this grade, 40 in all, 3 higher.");
      await expect(report).toContainText("54/46 left-right · 49/51 top-bottom");
      await expect(report.getByTestId("centering-caps")).toContainText("TAG Gem Mint 10");
      // No token on this server: the lookup is explained, not offered, and a TAG card never has it anyway.
      await expect(report.getByRole("button", { name: "Look up on PSA" })).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/cards/${id}`);
    }
  });

  test("a PSA report seeded from PSA's record shows the scans and says how to set the lookup up", async ({ page }) => {
    const id = await create(page, {
      name: "Recorded Raichu",
      gradingCompany: "PSA",
      grade: "10",
      certNumber: "12345678",
      gradingReport: {
        company: "PSA",
        cert: "12345678",
        source: "psa",
        checkedAt: "2026-10-01T00:00:00.000Z",
        grade: "10",
        gradeText: "GEM MT 10",
        label: "Standard",
        population: { atGrade: 123, higher: 0 },
        images: { front: "https://images.psacard.com/cert/12345678/front.jpg", back: "https://images.psacard.com/cert/12345678/back.jpg" },
        identity: { subject: "RAICHU-HOLO", brand: "POKEMON GAME", year: "1999", cardNumber: "14", variety: null, category: "TCG Cards" },
      },
    });
    try {
      await page.goto(`/cards/${id}`);
      const report = page.getByTestId("grading-report");
      await expect(report.getByRole("link", { name: "View on PSA" })).toHaveAttribute("href", "https://www.psacard.com/cert/12345678/psa");
      await expect(report).toContainText("grade GEM MT 10 · checked");
      await expect(report).toContainText("from PSA's records");
      await expect(report).toContainText("PSA lists it as: 1999 POKEMON GAME RAICHU-HOLO #14 (TCG Cards)");
      const front = report.getByRole("img", { name: "PSA front scan" });
      await expect(front).toHaveAttribute("src", "https://images.psacard.com/cert/12345678/front.jpg");
      await expect(front).toHaveAttribute("referrerpolicy", "no-referrer");
      await expect(report).toContainText("Set PSA_API_TOKEN on the server");
      await expect(report.getByRole("button", { name: "Look up on PSA" })).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/cards/${id}`);
    }
  });

  test("a report entered by hand is saved with the cert and shown", async ({ page }) => {
    const id = await create(page, { name: "Handwritten Hitmonlee", gradingCompany: "BGS", grade: "9.5" });
    try {
      await page.goto(`/cards/${id}`);
      const report = page.getByTestId("grading-report");
      await expect(report).toContainText("No cert number recorded.");
      await report.getByRole("button", { name: "Enter the report by hand" }).click();
      await report.getByLabel("Cert number").fill("0012345678");
      await report.getByLabel("Centering subgrade").fill("9.5");
      await report.getByLabel("Corners subgrade").fill("10");
      await report.getByLabel("Front", { exact: true }).fill("55/45 52/48");
      await report.getByRole("button", { name: "Save report" }).click();
      await expect(report.getByRole("link", { name: "View on Beckett" })).toHaveAttribute("href", "https://www.beckett.com/grading/card-lookup?item_type=BGS&item_id=12345678");
      await expect(report).toContainText("entered by hand from the report");
      await expect(report).toContainText("55/45 left-right · 52/48 top-bottom");
      await expect(page.getByText("CERT 0012345678", { exact: true })).toBeVisible();
    } finally {
      await page.request.delete(`/api/cards/${id}`);
    }
  });

  test("Settings lists the PSA cert lookup as not configured, without a test button", async ({ page }) => {
    await page.goto("/settings");
    const row = page.locator("li", { hasText: "PSA cert lookup" });
    await expect(row).toContainText("Not configured");
    await expect(row).toContainText("Tested by the first lookup from a card page.");
    await expect(row.getByRole("button", { name: "Test connection" })).toHaveCount(0);
  });
});
