import { expect, test, type Page } from "@playwright/test";

async function create(page: Page, data: Record<string, unknown>): Promise<number> {
  const res = await page.request.post("/api/cards", { data: { game: "pokemon", setName: "Object Set", ...data } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { card: { id: number } }).card.id;
}

test.describe("the card as an object", () => {
  test("a gem-mint slab is pristine and a damaged raw card is not, the same way every time", async ({ page }) => {
    const slab = await create(page, { name: "Gem Mint Mew", gradingCompany: "PSA", grade: "10", certNumber: "55501234" });
    const raw = await create(page, { name: "Loved Lapras", condition: "DMG" });

    await page.goto(`/cards/${slab}`);
    const label = page.locator(".slab-label").first();
    await expect(label).toContainText("PSA");
    await expect(label).toContainText("10");
    await expect(page.getByText("CERT 55501234")).toBeVisible();
    await expect(page.locator(".card3d-wear").first()).toHaveAttribute("data-wear-count", "0");
    await expect(page.locator(".slab3d-front")).toHaveCount(1);

    await page.goto(`/cards/${raw}`);
    await expect(page.locator(".slab-label")).toHaveCount(0);
    const wear = page.locator(".card3d-wear").first();
    const count = Number(await wear.getAttribute("data-wear-count"));
    expect(count).toBeGreaterThan(10);
    // A damaged card is creased across two corners.
    await expect(wear.locator("line[stroke='#000']")).toHaveCount(2);
    // The marks come from the card's id, so a reload draws the same ones.
    await page.reload();
    await expect(wear).toHaveAttribute("data-wear-count", String(count));
  });

  test("the card tilts towards the pointer and settles back when it leaves", async ({ page }) => {
    const id = await create(page, { name: "Tilting Togepi" });
    await page.goto(`/cards/${id}`);
    const scene = page.locator(".card3d-scene").first();
    const body = page.locator(".card3d-body").first();
    const resting = await body.evaluate((el) => getComputedStyle(el).transform);

    const box = (await scene.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.15);
    await expect.poll(() => body.evaluate((el) => el.style.getPropertyValue("--ry"))).not.toBe("");
    await expect.poll(() => body.evaluate((el) => getComputedStyle(el).transform)).not.toBe(resting);

    await page.mouse.move(0, 0);
    await expect.poll(() => body.evaluate((el) => el.style.getPropertyValue("--ry"))).toBe("");
    await expect.poll(() => body.evaluate((el) => getComputedStyle(el).transform), { timeout: 3000 }).toBe(resting);
  });

  test("a finish shimmers where it should, and a worn foil peels and curls unless it is slabbed", async ({ page }) => {
    const holo = await create(page, { name: "Shiny Scyther", variant: "holo" });
    const plain = await create(page, { name: "Plain Pidgey" });
    const foil = await create(page, { name: "Curled Kabuto", variant: "Etched Foil", condition: "DMG" });
    const slabbed = await create(page, { name: "Flat Kabutops", variant: "foil", gradingCompany: "PSA", grade: "3" });

    await page.goto(`/cards/${holo}`);
    await expect(page.locator(".card3d-face").first()).toHaveAttribute("data-finish", "holo");
    await expect(page.locator(".card3d-holo-holo")).toHaveCount(1);

    await page.goto(`/cards/${plain}`);
    await expect(page.locator(".card3d-holo")).toHaveCount(0);
    await expect(page.locator(".card3d-face").first()).not.toHaveAttribute("data-finish", /.+/);

    await page.goto(`/cards/${foil}`);
    await expect(page.locator(".card3d-holo-foil")).toHaveCount(1);
    expect(await page.locator("[data-peel]").count()).toBeGreaterThan(0);
    const warp = Number(await page.locator(".card3d-body").first().getAttribute("data-warp"));
    expect(Math.abs(warp)).toBeGreaterThan(0);
    await expect(page.locator(".card3d-curve")).toHaveCount(1);

    await page.goto(`/cards/${slabbed}`);
    await expect(page.locator(".card3d-body").first()).toHaveAttribute("data-warp", "0.00");
    await expect(page.locator(".card3d-curve")).toHaveCount(0);
  });

  test("in the grid a slab keeps its label and a raw card its own colour", async ({ page }) => {
    await create(page, { name: "Gridded Gengar", gradingCompany: "BGS", grade: "9.5" });
    await create(page, { name: "Gridded Golem", accentColor: "#2f6feb" });
    await page.goto("/collection?q=Gridded");
    const slab = page.getByRole("link", { name: /Gridded Gengar/ });
    await expect(slab.locator(".slab-label")).toContainText("BGS");
    await expect(slab.locator(".card3d-wear")).toHaveAttribute("data-wear-count", "0");
    const raw = page.getByRole("link", { name: /Gridded Golem/ });
    await expect(raw.locator(".accent-wash")).toBeVisible();
    expect(await raw.locator(".accent-wash").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("gradient");
    expect(Number(await raw.locator(".card3d-wear").getAttribute("data-wear-count"))).toBeGreaterThan(0);
  });
});
