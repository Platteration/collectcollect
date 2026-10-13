import { expect, test } from "./fixtures";

/**
 * An item's picture is drawn from Steam's two image hosts, the ones the
 * policy's img-src names (src/lib/images.ts), and from nowhere else. Each host
 * is measured here: a page draws a picture from it under the policy. An item
 * whose address names any other host keeps it, but the page shows "No image"
 * rather than ask for something the policy refuses, which fixtures.ts would
 * fail as a violation and a visitor would see as a broken picture.
 *
 * The servers under test reach no network, and a picture is the browser's own
 * request, so the test answers for Steam's hosts itself.
 */

// One transparent pixel.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

test("an item's picture is drawn from Steam's two hosts, and an address anywhere else is not asked for", async ({ page }) => {
  const asked: string[] = [];
  await page.route(/^https:\/\/(community\.cloudflare\.steamstatic\.com|steamcommunity-a\.akamaihd\.net|images\.example\.com)\//, (route) => {
    asked.push(new URL(route.request().url()).host);
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });

  const stamp = Date.now();
  const pictures: Record<string, string> = {
    cloudflare: `https://community.cloudflare.steamstatic.com/economy/image/pictured-${stamp}/360fx360f`,
    akamai: `https://steamcommunity-a.akamaihd.net/economy/image/pictured-${stamp}`,
    elsewhere: `https://images.example.com/pictured-${stamp}.png`,
  };
  const ids: Record<string, number> = {};
  let price = 900_000;
  for (const [where, imageUrl] of Object.entries(pictures)) {
    // Priced far above anything else here, so each is one of the portfolio's top holdings.
    const res = await page.request.post("/api/items", { data: { marketHashName: `Pictured ${where} Case ${stamp}`, category: "case", quantity: 1, imageUrl, manualPrice: price++ } });
    expect(res.ok(), await res.text()).toBe(true);
    ids[where] = ((await res.json()) as { item: { id: number } }).item.id;
  }
  try {
    // A drawn picture has loaded; the other shows the words instead.
    const drawn = async (scope: ReturnType<typeof page.locator>) => expect(scope.locator("img")).toHaveJSProperty("naturalWidth", 1);
    const notDrawn = async (scope: ReturnType<typeof page.locator>) => expect(scope.locator("img")).toHaveCount(0);

    // The inventory's grid.
    await page.goto(`/inventory?q=${stamp}`);
    const tile = (where: string) => page.locator(`a[href="/items/${ids[where]}"]`);
    await drawn(tile("cloudflare"));
    await drawn(tile("akamai"));
    await notDrawn(tile("elsewhere"));
    await expect(tile("elsewhere").getByText("No image")).toBeVisible();

    // Each item's own page.
    for (const where of ["cloudflare", "akamai", "elsewhere"]) {
      await page.goto(`/items/${ids[where]}`);
      const header = page.locator("header").filter({ has: page.getByRole("heading", { name: new RegExp(`Pictured ${where} Case`) }) });
      if (where === "elsewhere") {
        await notDrawn(header);
        await expect(header.getByText("No image")).toBeVisible();
      } else {
        await drawn(header);
      }
    }

    // The portfolio's top holdings.
    await page.goto("/");
    const holding = (where: string) => page.locator("section", { has: page.getByRole("heading", { name: "Top holdings" }) }).locator(`a[href="/items/${ids[where]}"]`);
    await drawn(holding("cloudflare"));
    await drawn(holding("akamai"));
    await expect(holding("elsewhere")).toBeVisible();
    await notDrawn(holding("elsewhere"));

    expect(new Set(asked)).toEqual(new Set(["community.cloudflare.steamstatic.com", "steamcommunity-a.akamaihd.net"]));

    // The address is still the item's, as it was given.
    const kept = (await (await page.request.get(`/api/items/${ids.elsewhere}`)).json()) as { item: { imageUrl: string | null } };
    expect(kept.item.imageUrl).toBe(pictures.elsewhere);
  } finally {
    for (const id of Object.values(ids)) await page.request.delete(`/api/items/${id}`);
  }
});
