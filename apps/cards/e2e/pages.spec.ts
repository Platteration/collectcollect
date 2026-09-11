import { expect, test } from "@playwright/test";

test.describe("what every response carries", () => {
  test("security headers, and a content security policy the page's own scripts satisfy", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    const response = await page.goto("/");
    const headers = response!.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=(self)");
    const csp = headers["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");

    // The inline theme script carries the nonce and ran: the attribute it sets
    // is there before anything else could have put it there.
    await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
    // And the app's own bundles loaded, so the page is interactive.
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "System" }).click();

    for (const path of ["/collection", "/settings", "/report", "/add"]) await page.goto(path);
    expect(violations).toEqual([]);
    // A fresh nonce every time.
    const again = await page.goto("/");
    expect(again!.headers()["content-security-policy"]).not.toBe(csp);
  });
});

test.describe("a page that is not there", () => {
  test("is a 404 with the app still around it", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
    // The header survives, so there is somewhere to go.
    await expect(page.getByRole("banner").getByRole("link", { name: "Collection" })).toBeVisible();
    await page.getByRole("link", { name: "Open the collection" }).click();
    await expect(page).toHaveURL(/\/collection$/);
    // A card that is not there gets the same page.
    expect((await page.goto("/cards/999999"))?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
  });
});

test.describe("the pages nothing else visits", () => {
  test("the appraisal report totals what the collection is worth", async ({ page }) => {
    // Its own cards, so the shared collection's other tests cannot move the
    // numbers this one asserts on.
    const made = await Promise.all([
      page.request.post("/api/cards", {
        data: { game: "pokemon", name: "Report Machamp", setName: "Report Set", quantity: 3, manualUngraded: 25, location: "Report Box" },
      }),
      page.request.post("/api/cards", {
        data: { game: "mtg", name: "Report Mox", setName: "Report Set", quantity: 1, gradingCompany: "BGS", grade: "9.5" },
      }),
    ]);
    const ids = await Promise.all(made.map(async (r) => ((await r.json()) as { card: { id: number } }).card.id));

    try {
      // Give the first card a price; the second deliberately has none.
      const priced = await page.request.post(`/api/cards/${ids[0]}/price`, { data: {} });
      expect(priced.ok()).toBe(true);

      await page.goto("/report");
      await expect(page.getByRole("heading", { name: "Collection valuation" })).toBeVisible();

      const row = page.locator("tr", { hasText: "Report Machamp" });
      await expect(row).toContainText("Report Box");
      await expect(row).toContainText("3");
      // 3 copies at the manual $25 each.
      await expect(row).toContainText("$75.00");

      // The unpriced card is listed rather than hidden, and says so.
      const mox = page.locator("tr", { hasText: "Report Mox" });
      await expect(mox).toContainText("BGS 9.5");
      await expect(mox).toContainText("—");
      await expect(page.getByText("Unpriced")).toBeVisible();
    } finally {
      for (const id of ids) await page.request.delete(`/api/cards/${id}`);
    }
  });

  test("alerts are listed, counted in the header, then read and dismissed", async ({ page }) => {
    const made = await page.request.post("/api/cards", {
      data: { game: "pokemon", name: "Alerting Ampharos", setName: "Alert Set", manualUngraded: 10 },
    });
    const { card } = (await made.json()) as { card: { id: number } };

    try {
      await page.goto("/alerts");
      await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
      const empty = await page.getByText(/Nothing yet\./).count();

      // A price that moves far enough raises one.
      await page.request.patch(`/api/cards/${card.id}`, { data: { manualUngraded: 10 } });
      await page.request.post(`/api/cards/${card.id}/price`, { data: {} });
      await page.request.patch(`/api/cards/${card.id}`, { data: { manualUngraded: 40 } });
      await page.request.post(`/api/cards/${card.id}/price`, { data: {} });

      await page.goto("/alerts");
      const alert = page.locator("li, article, div").filter({ hasText: "Alerting Ampharos" }).first();
      await expect(alert).toBeVisible();
      if (empty > 0) await expect(page.getByText(/Nothing yet\./)).toHaveCount(0);

      // Seeing the list is the acknowledgement, so the badge clears.
      await expect(page.getByRole("navigation").first()).not.toContainText(/Alerts\s*\d/);

      // A dismiss the server refuses puts the row back and says why.
      await page.route("**/api/alerts/*", (route) =>
        route.request().method() === "DELETE"
          ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk is full" }) })
          : route.continue(),
      );
      const dismiss = alert.getByRole("button", { name: /Dismiss/i }).first();
      await dismiss.click();
      await expect(page.getByRole("alert").filter({ hasText: /Could not dismiss/ })).toContainText("disk is full");
      await expect(alert).toBeVisible();
      await page.unroute("**/api/alerts/*");

      await alert.getByRole("button", { name: /Dismiss/i }).first().click();
      await expect(page.getByText("Alerting Ampharos")).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/cards/${card.id}`);
    }
  });

  test("settings refuses a multiplier that is not a number instead of saying it saved", async ({ page }) => {
    await page.goto("/settings");
    const lp = page.getByLabel("Lightly Played");
    const before = await lp.inputValue();
    try {
      await lp.fill("abc");
      await page.getByRole("button", { name: /^Save settings$/ }).click();
      await expect(page.getByRole("alert").filter({ hasText: /none of your settings were changed/ })).toBeVisible();
      // Nothing was saved, so the stored value is still the old one.
      await page.reload();
      await expect(page.getByLabel("Lightly Played")).toHaveValue(before);

      // And a real number still saves.
      await page.getByLabel("Lightly Played").fill("0.9");
      await page.getByRole("button", { name: /^Save settings$/ }).click();
      await expect(page.getByText(/Saved\./)).toBeVisible();
      await page.reload();
      await expect(page.getByLabel("Lightly Played")).toHaveValue("0.9");
    } finally {
      // Every test shares these settings, and a condition multiplier changes
      // what other tests' cards are worth.
      await page.getByLabel("Lightly Played").fill(before);
      await page.getByRole("button", { name: /^Save settings$/ }).click();
      await expect(page.getByText(/Saved\./)).toBeVisible();
    }
  });
});
