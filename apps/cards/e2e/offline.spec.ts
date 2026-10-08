import { expect, test } from "./fixtures";

// The suite promises it never calls a price API. A saved card's price refresh
// runs on the server, where no page.route can answer it, so the servers under
// test are started with no network at all (scripts/e2e-offline.mjs): a lookup
// fails at once, and says so, instead of reaching api.pokemontcg.io.
test("the servers under test reach no price API", async ({ request }) => {
  const headers = { "sec-fetch-site": "same-origin" };
  const created = await request.post("/api/cards", { headers, data: { game: "pokemon", name: "Offline Pikachu" } });
  expect(created.status()).toBe(201);
  const { card }: { card: { id: number } } = await created.json();

  const priced = await request.post(`/api/cards/${card.id}/price`, { headers });
  expect(priced.status()).toBe(200);
  const { snapshot }: { snapshot: { summary: { errors: Array<{ source: string; message: string }> } } } = await priced.json();
  expect(snapshot.summary.errors).toContainEqual({ source: "pokemontcg", message: "fetch failed: the e2e servers have no network (api.pokemontcg.io)" });
  // Whatever else the shell running the suite has keys for fails the same way.
  for (const error of snapshot.summary.errors) expect(error.message, error.source).toMatch(/the e2e servers have no network/);
});
