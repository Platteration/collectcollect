import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumePreview, PREVIEW_TTL_MS, rememberPreview } from "@/lib/steam/preview";
import { POST, throttle } from "@/app/api/steam/import/route";
import { openDatabase, setDb } from "@/lib/db";
import { listItems } from "@/lib/items";
const steamId = "76561198000000001";
const item = { marketHashName: "Dreams & Nightmares Case", quantity: 2, category: "case" as const, stackable: true };
beforeEach(() => { setDb(openDatabase(":memory:")); throttle.reset(); });
describe("reviewed Steam snapshots", () => {
  it("binds the account, copies the payload and permits only one apply", () => {
    const input = [{ ...item }];
    const { token } = rememberPreview(steamId, input, 1, 1000);
    input[0]!.quantity = 50;
    expect(consumePreview(token, "76561198000000002", 1001)).toBeNull();
    expect(consumePreview(token, steamId, 1001)).toMatchObject({ items: [{ quantity: 2 }], unmatched: 1 });
    expect(consumePreview(token, steamId, 1002)).toBeNull();
  });
  it("rejects expired snapshots", () => {
    const { token } = rememberPreview(steamId, [item], 0, 1000);
    expect(consumePreview(token, steamId, 1000 + PREVIEW_TTL_MS)).toBeNull();
  });
  it("applies reviewed data without fetching Steam again, and refuses missing tokens", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      const post = (body: unknown) => POST(new Request("http://localhost/api/steam/import", { method: "POST", body: JSON.stringify(body) }));
      expect((await post({ steamId })).status).toBe(409);
      const { token } = rememberPreview(steamId, [item], 0);
      const response = await post({ steamId, previewToken: token });
      expect(response.status).toBe(200);
      expect(listItems()).toMatchObject([{ marketHashName: item.marketHashName, quantity: 2, purchasePrice: null }]);
      expect((await post({ steamId, previewToken: token })).status).toBe(409);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
