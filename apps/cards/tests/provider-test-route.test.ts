import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, throttle } from "@/app/api/providers/test/route";
import { providerStatuses, testableProviderIds } from "@/lib/status";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/providers/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("Settings' Test connection", () => {
  beforeEach(() => {
    throttle.reset();
    // No key in the shell running the tests, and no request that leaves it: a configured free source is asked through this stub.
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "PRICECHARTING_TOKEN", "POKEMONTCG_API_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"]) vi.stubEnv(name, "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("offers the test for the sources the page lists, eBay among them", () => {
    expect(testableProviderIds()).toEqual(providerStatuses().filter((p) => p.testable).map((p) => p.id));
    expect(testableProviderIds()).toEqual(expect.arrayContaining(["claude", "pokemontcg", "pricecharting", "scryfall", "ygoprodeck", "ebay"]));
    // The PSA lookup spends one of the day's lookups, so it has no test.
    expect(testableProviderIds()).not.toContain("psa");
  });

  it("answers every id the page offers a button for, not 'Unknown provider'", async () => {
    // eBay was listed with a button and refused here as unknown.
    for (const id of providerStatuses().filter((p) => p.testable).map((p) => p.id)) {
      throttle.reset();
      const res = await post({ id });
      expect(res.status, id).toBe(200);
      const body = (await res.json()) as { ok: boolean; message: string };
      expect(typeof body.ok, id).toBe("boolean");
      expect(body.message, id).not.toBe("Unknown provider.");
      expect(body.message.length, id).toBeGreaterThan(0);
    }
  });

  it("says what is missing for eBay without its keys, and asks eBay nothing", async () => {
    const res = await post({ id: "ebay" });
    expect(await res.json()).toEqual({ ok: false, message: "Add this provider's key to the environment and restart the app." });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("still refuses an id the page does not offer", async () => {
    for (const id of ["psa", "nonsense", "", 7, null]) {
      throttle.reset();
      const res = await post({ id });
      expect(res.status, String(id)).toBe(400);
      expect(await res.json()).toEqual({ error: "Unknown provider" });
    }
  });
});
