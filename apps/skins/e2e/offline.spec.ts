import { expect, test } from "@playwright/test";

// The suite promises it never asks a market for a price. A priced item's lookup
// runs on the server, where no page.route can answer it, so the servers under
// test are started with no network at all (scripts/e2e-offline.mjs): a lookup
// fails at once, and says so, instead of reaching Skinport or Steam.
test("the servers under test reach no market", async ({ request }) => {
  const headers = { "sec-fetch-site": "same-origin" };
  const created = await request.post("/api/items", { headers, data: { marketHashName: "Offline Case", category: "case", quantity: 1 } });
  expect(created.status()).toBe(201);
  const { item }: { item: { id: number } } = await created.json();

  const priced = await request.post(`/api/items/${item.id}/price`, { headers });
  expect(priced.status()).toBe(200);
  const { summary }: { summary: { errors: Array<{ source: string; message: string }> } } = await priced.json();
  const messages = summary.errors.map((e) => e.message);
  expect(messages.some((m) => m.includes("the e2e servers have no network (api.skinport.com)"))).toBe(true);
  expect(messages.some((m) => m.includes("the e2e servers have no network (steamcommunity.com)"))).toBe(true);
  for (const message of messages) expect(message).toMatch(/the e2e servers have no network/);
});
