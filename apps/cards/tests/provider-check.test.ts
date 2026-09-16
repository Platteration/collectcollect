import { afterEach, expect, it, vi } from "vitest";
import { checkProvider } from "@/lib/provider-check";
import { fakeFetch } from "./helpers";
afterEach(() => vi.unstubAllEnvs());
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
