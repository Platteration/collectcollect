import { expect, type Page } from "@playwright/test";

/** A card photo made in the browser, so the tests need no binary fixtures. */
export async function cardPhoto(page: Page, rgb: [number, number, number]): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const dataUrl = await page.evaluate(([r, g, b]) => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 420;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, rgb);
  return { name: `card-${rgb.join("-")}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
}

export interface StubCard {
  name: string;
  set_name?: string;
  card_number?: string;
  confidence?: number;
  game?: string;
}

/**
 * Answer identification requests with canned results, in order. Keeps the whole
 * client pipeline under test while never calling the real model.
 */
export async function stubIdentify(page: Page, cards: StubCard[]) {
  let i = 0;
  await page.route("**/api/identify", async (route) => {
    const c = cards[Math.min(i++, cards.length - 1)];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        identification: {
          game: c.game ?? "pokemon",
          sport: null,
          name: c.name,
          set_name: c.set_name ?? "Base Set",
          set_code: null,
          card_number: c.card_number ?? null,
          year: 1999,
          rarity: "Rare Holo",
          variant: "holo",
          language: "English",
          manufacturer: null,
          subject: c.name,
          grading: { company: null, grade: null, cert_number: null },
          condition_notes: null,
          condition_assessment: {
            centering: "55/45",
            corners: "sharp",
            edges: "clean",
            surface: "clean",
            estimated_grade_low: "8",
            estimated_grade_high: "9",
            caveat: null,
          },
          confidence: c.confidence ?? 0.95,
          alternatives: [],
          search_query: c.name,
        },
      }),
    });
  });
}

/** Price lookups would reach third-party APIs, so give them a fixed answer. */
export async function stubPrices(page: Page, opts: { ungraded: number; psa10: number }) {
  const summary = {
    currency: "USD",
    fetchedAt: new Date().toISOString(),
    ungraded: opts.ungraded,
    ungradedSource: "Test source",
    graded: { "PSA 10": opts.psa10 },
    gradedSource: "Test source",
    estimatedGraded: {},
    yourCopyValue: opts.ungraded,
    yourCopyBasis: "Test",
    quotes: [],
    errors: [],
  };
  await page.route("**/api/prices/lookup", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary }) }),
  );
}

export async function addCardByHand(
  page: Page,
  fields: { name: string; game?: string; set?: string; number?: string; purchase?: string; quantity?: string },
) {
  await page.goto("/add");
  await page.getByRole("button", { name: "Enter a card manually" }).click();
  const form = page.locator("fieldset").first();
  if (fields.game) await form.getByLabel("Game / category").selectOption(fields.game);
  // The name field is labelled "Player" for sports cards.
  await form.getByLabel(fields.game === "sports" ? "Player" : "Card name").fill(fields.name);
  if (fields.set) await form.getByLabel("Set / product").fill(fields.set);
  if (fields.number) await form.getByLabel("Card number").fill(fields.number);
  if (fields.quantity) await form.getByLabel("Quantity").fill(fields.quantity);
  if (fields.purchase) await form.getByLabel("Purchase price (USD)").fill(fields.purchase);
  await page.getByRole("button", { name: "Save to collection" }).click();
  await expect(page.getByText(/Saved/).first()).toBeVisible();
}
