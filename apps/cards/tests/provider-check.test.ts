import { afterEach, expect, it, vi } from "vitest";
import { checkProvider } from "@/lib/provider-check";
import { fakeFetch } from "./helpers";
import { forgetEbayToken, setEbayLimit } from "@/lib/pricing/providers/ebay";
import { NO_LIMIT } from "@collectcollect/core/limiter";
afterEach(() => {
  vi.unstubAllEnvs();
  setEbayLimit(NO_LIMIT);
  forgetEbayToken();
});
it("works without optional credentials and never sends a request for an unknown provider", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  const fetch = vi.fn();
  expect(await checkProvider("claude", fetch)).toMatchObject({ ok: false });
  expect(await checkProvider("unknown", fetch)).toEqual({ ok: false, message: "Unknown provider." });
  expect(fetch).not.toHaveBeenCalled();
});
it("reports a successful free-provider connection without requiring a price match", async () => {
  expect(await checkProvider("scryfall", fakeFetch([["api.scryfall.com", {}, 404]]))).toMatchObject({ ok: true });
});
it("does not echo credentials or upstream error bodies", async () => {
  const fetch = vi.fn(async () => { throw new Error("network failure with SECRET-KEY"); });
  const result = await checkProvider("scryfall", fetch);
  expect(result.ok).toBe(false);
  expect(result.message).not.toContain("SECRET-KEY");
});

const EBAY_TOKEN = ["api.ebay.com/identity", { access_token: "t", expires_in: 7200 }] as [string, unknown];
it("probes eBay with a sample card once both keys are set", async () => {
  setEbayLimit(NO_LIMIT); forgetEbayToken();
  vi.stubEnv("EBAY_CLIENT_ID", "id"); vi.stubEnv("EBAY_CLIENT_SECRET", "secret");
  const sales = { itemSales: [{ title: "Charizard Base 4 Holo", lastSoldPrice: { value: "100.00", currency: "USD" } }] };
  expect(await checkProvider("ebay", fakeFetch([EBAY_TOKEN, ["marketplace_insights", sales]]))).toEqual({ ok: true, message: "Connection succeeded and a sample price was returned." });
  expect(await checkProvider("ebay", fakeFetch([EBAY_TOKEN, ["marketplace_insights", { itemSales: [] }]]))).toEqual({ ok: true, message: "Connection succeeded. No price matched the sample card." });
});
it("says an eBay account without the API's approval is the reason, in the app's words and not eBay's", async () => {
  setEbayLimit(NO_LIMIT); forgetEbayToken();
  vi.stubEnv("EBAY_CLIENT_ID", "id"); vi.stubEnv("EBAY_CLIENT_SECRET", "SECRET-KEY");
  const scope = await checkProvider("ebay", fakeFetch([["api.ebay.com/identity", { error: "invalid_scope", error_description: "SECRET-BODY" }, 400]]));
  expect(scope.ok).toBe(false);
  expect(scope.message).toMatch(/Limited Release/);
  forgetEbayToken();
  const forbidden = await checkProvider("ebay", fakeFetch([EBAY_TOKEN, ["marketplace_insights", { errors: [{ errorId: 1100, message: "SECRET-BODY" }] }, 403]]));
  expect(forbidden.ok).toBe(false);
  expect(forbidden.message).toMatch(/Limited Release/);
  for (const result of [scope, forbidden]) {
    expect(result.message).not.toContain("SECRET-BODY");
    expect(result.message).not.toContain("SECRET-KEY");
  }
});
it("says a rate limited eBay is the reason, and still reports an unreachable one without its words", async () => {
  setEbayLimit(NO_LIMIT); forgetEbayToken();
  vi.stubEnv("EBAY_CLIENT_ID", "id"); vi.stubEnv("EBAY_CLIENT_SECRET", "secret");
  const limited = await checkProvider("ebay", fakeFetch([EBAY_TOKEN, ["marketplace_insights", {}, 429]]));
  expect(limited).toMatchObject({ ok: false, message: expect.stringMatching(/rate limiting this app/) });
  forgetEbayToken();
  const down = await checkProvider("ebay", vi.fn(async () => { throw new Error("socket hang up with SECRET-KEY"); }) as unknown as typeof fetch);
  expect(down.ok).toBe(false);
  expect(down.message).not.toContain("SECRET-KEY");
});
