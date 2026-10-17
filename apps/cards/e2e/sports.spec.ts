import { expect } from "./fixtures";
import { test } from "./scan-fixture";
import type { Page } from "./fixtures";

/** A sports card by hand, with whatever of its sports fields a test names. */
async function addSports(
  page: Page,
  fields: { name: string; team?: string; parallel?: string; serial?: string; rookie?: boolean; autograph?: boolean; company?: string; grade?: string; subgrades?: string[]; centering?: string },
) {
  await page.goto("/add");
  await page.getByRole("button", { name: "Enter a card manually" }).click();
  const form = page.locator("fieldset").first();
  await form.getByLabel("Game / category").selectOption("sports");
  await form.getByLabel("Player").fill(fields.name);
  await form.getByLabel("Set / product").fill("Topps Chrome");
  await form.getByLabel("Card number").fill("US175");
  if (fields.team) await form.getByLabel("Team").fill(fields.team);
  if (fields.parallel) await form.getByLabel("Parallel / refractor").fill(fields.parallel);
  if (fields.serial) await form.getByLabel("Serial number").fill(fields.serial);
  if (fields.rookie) await form.getByLabel("Rookie card").check();
  if (fields.autograph) await form.getByLabel("Autograph").check();
  if (fields.company) await form.getByLabel("Grading company").selectOption(fields.company);
  if (fields.grade) await form.getByLabel("Grade", { exact: true }).fill(fields.grade);
  const [centering, corners, edges, surface] = fields.subgrades ?? [];
  if (centering) await form.getByLabel("Centering subgrade").fill(centering);
  if (corners) await form.getByLabel("Corners subgrade").fill(corners);
  if (edges) await form.getByLabel("Edges subgrade").fill(edges);
  if (surface) await form.getByLabel("Surface subgrade").fill(surface);
  if (fields.centering) await form.getByLabel("Front centering (left/right)").fill(fields.centering);
  const priced = page.waitForResponse((r) => r.request().method() === "POST" && /^\/api\/cards\/\d+\/price$/.test(new URL(r.url()).pathname));
  priced.catch(() => undefined);
  await page.getByRole("button", { name: "Save to collection" }).click();
  // In an object, so that awaiting this function does not wait for a price a duplicate prompt never asks for.
  return { priced };
}

async function cardsNamed(page: Page, name: string): Promise<Array<{ id: number; quantity: number; serialNumber: string | null; parallel: string | null }>> {
  const res = await page.request.get(`/api/cards?q=${encodeURIComponent(name)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { cards: Array<{ id: number; quantity: number; serialNumber: string | null; parallel: string | null }> }).cards;
}

async function removeAll(page: Page, name: string) {
  for (const card of await cardsNamed(page, name)) await page.request.delete(`/api/cards/${card.id}`);
}

test.describe("sports cards", () => {
  test("a numbered BGS card is added at phone width, shown, edited and exported with its sports fields", async ({ page }) => {
    const name = `Sports Trout ${Date.now()}`;
    await page.setViewportSize({ width: 360, height: 800 });
    try {
      const { priced } = await addSports(page, {
        name, team: "Los Angeles Angels", parallel: "Gold Refractor", serial: "12 of 50", rookie: true, autograph: true,
        company: "BGS", grade: "9.5", subgrades: ["9.5", "9", "10", "9.5"], centering: "55/45",
      });
      await expect(page.getByText(/Saved/).first()).toBeVisible();
      expect((await priced).status()).toBe(200);
      // The form was fully usable at 360 px: nothing pushed the page sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const [card] = await cardsNamed(page, name);
      expect(card).toMatchObject({ serialNumber: "12/50", parallel: "Gold Refractor" });
      await page.goto(`/cards/${card!.id}`);
      const details = page.locator("dl").filter({ hasText: "Numbered" });
      await expect(details).toContainText("Los Angeles Angels");
      await expect(details.locator("div").filter({ hasText: /^Parallel/ })).toContainText("Gold Refractor");
      await expect(details.locator("div").filter({ hasText: /^Numbered/ })).toContainText("12/50");
      await expect(details.locator("div").filter({ hasText: /^Card type/ })).toContainText("Rookie · Autograph");
      await expect(details.locator("div").filter({ hasText: /^Subgrades/ })).toContainText("C 9.5 · Co 9 · E 10 · S 9.5");
      // The centering that was measured is a different thing, and is still there.
      await expect(page.getByText("55/45 left-right")).toBeVisible();

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const form = page.locator("fieldset").first();
      // Each field comes back in its own box, subgrades and measured centering apart.
      await expect(form.getByLabel("Team")).toHaveValue("Los Angeles Angels");
      await expect(form.getByLabel("Serial number")).toHaveValue("12/50");
      await expect(form.getByLabel("Rookie card")).toBeChecked();
      await expect(form.getByLabel("Relic / patch")).not.toBeChecked();
      await expect(form.getByLabel("Centering subgrade")).toHaveValue("9.5");
      await expect(form.getByLabel("Corners subgrade")).toHaveValue("9");
      await expect(form.getByLabel("Front centering (left/right)")).toHaveValue("55/45");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: "test-results/sports-form-360.png", fullPage: true });
      await form.getByLabel("Team").fill("Anaheim Angels");
      await form.getByLabel("Relic / patch").check();
      await form.getByLabel("Edges subgrade").fill("9.5");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(details.locator("div").filter({ hasText: /^Card type/ })).toContainText("Rookie · Autograph · Relic");
      await expect(details).toContainText("Anaheim Angels");
      await expect(details.locator("div").filter({ hasText: /^Subgrades/ })).toContainText("E 9.5");
      // Saved, not only shown: the measured centering and the numbering came through the edit untouched.
      expect((await cardsNamed(page, name))[0]).toMatchObject({ serialNumber: "12/50" });
      await page.reload();
      await expect(page.getByText("55/45 left-right")).toBeVisible();

      const csv = await (await page.request.get("/api/export")).text();
      const header = csv.split("\r\n")[0]!.split(",");
      expect(header).toEqual(expect.arrayContaining(["team", "rookie", "parallel", "serial_number", "autograph", "relic", "subgrade_centering", "subgrade_corners", "subgrade_edges", "subgrade_surface"]));
      const line = csv.split("\r\n").find((l) => l.includes(name))!;
      expect(line).toContain("Anaheim Angels,yes,Gold Refractor,12/50,yes,yes");
      expect(line).toContain(",9.5,9,9.5,9.5,");
    } finally {
      await removeAll(page, name);
    }
  });

  test("a numbered card and a parallel are not offered as a copy of the base card", async ({ page }) => {
    const name = `Sports Duplicate ${Date.now()}`;
    try {
      await addSports(page, { name });
      await expect(page.getByText(/Saved/).first()).toBeVisible();
      // A numbered card and a Refractor go straight in: neither is the card already held.
      await addSports(page, { name, serial: "7/25" });
      await expect(page.getByText(/Saved/).first()).toBeVisible();
      await expect(page.getByText("Looks like you already have this card")).toHaveCount(0);
      await addSports(page, { name, parallel: "Refractor" });
      await expect(page.getByText(/Saved/).first()).toBeVisible();
      await expect(page.getByText("Looks like you already have this card")).toHaveCount(0);
      expect(await cardsNamed(page, name)).toHaveLength(3);

      // A second base copy is the one that is offered, and only the base card is offered it.
      await addSports(page, { name });
      await expect(page.getByText("Looks like you already have this card")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add as another copy" })).toHaveCount(1);
      await page.getByRole("button", { name: "Add as another copy" }).click();
      await expect(page.getByText(/Saved/).first()).toBeVisible();
      const held = await cardsNamed(page, name);
      expect(held.map((c) => `${c.parallel ?? "base"}:${c.serialNumber ?? "-"}:${c.quantity}`).sort()).toEqual(["Refractor:-:1", "base:-:2", "base:7/25:1"]);
    } finally {
      await removeAll(page, name);
    }
  });

  test("a scanned numbered card is its own card, and base scans stack on the base card", async ({ page, scan }) => {
    const trout = { game: "sports", set_name: "Topps Chrome", card_number: "US175" } as const;
    const base = { sport: "baseball", team: "Los Angeles Angels", rookie: true, manufacturer: "Topps" };
    const numbered = { ...base, parallel: "Gold Refractor", serial_number: "12/50" };
    const fixture = await scan([
      { ...trout, name: "Scanned Trout", extra: base },
      { ...trout, name: "Scanned Trout", extra: numbered },
      { ...trout, name: "Scanned Trout", extra: numbered },
      { ...trout, name: "Scanned Trout", extra: base },
    ]);
    await page.goto("/scan");
    await page.locator("input[type=file]").setInputFiles(fixture.photos);
    await expect.poll(async () => (await fixture.drafts()).map((draft) => `${draft.status}:${draft.result ?? ""}`).sort(), { timeout: 30_000 })
      .toEqual(["committed:created", "committed:created", "committed:created", "committed:merged"]);

    const held = await cardsNamed(page, fixture.suffix);
    expect(held.map((c) => `${c.parallel ?? "base"}:${c.serialNumber ?? "-"}:${c.quantity}`).sort()).toEqual(["Gold Refractor:12/50:1", "Gold Refractor:12/50:1", "base:-:2"]);
    const numberedCard = held.find((c) => c.serialNumber)!;
    await page.goto(`/cards/${numberedCard.id}`);
    await expect(page.locator("dl").filter({ hasText: "Numbered" })).toContainText("12/50");
    await expect(page.locator("dl").filter({ hasText: "Numbered" })).toContainText("Los Angeles Angels");
  });
});
