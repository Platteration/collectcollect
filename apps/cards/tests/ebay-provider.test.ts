import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ebayProvider, isEbayConfigured, parseGrade } from "@/lib/pricing/providers/ebay";
import { ProviderError } from "@/lib/pricing/types";
import { fakeFetch } from "./helpers";

const ENV_KEYS = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};

function setCredentials(): void {
  process.env.EBAY_CLIENT_ID = "test-client-id";
  process.env.EBAY_CLIENT_SECRET = "test-client-secret";
}

function clearCredentials(): void {
  delete process.env.EBAY_CLIENT_ID;
  delete process.env.EBAY_CLIENT_SECRET;
}

function calledUrls(fetchImpl: typeof fetch): string[] {
  const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
  return mock.mock.calls.map((call: unknown[]) => {
    const input = call[0];
    return typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  });
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  clearCredentials();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const TOKEN_BODY = { access_token: "test-token", token_type: "Application Access Token", expires_in: 7200 };

const QUERY = { game: "pokemon" as const, name: "Charizard", setName: "Base Set", cardNumber: "4/102" };

describe("eBay provider configuration", () => {
  it("is not configured without both credentials, and lookup stays inert", async () => {
    expect(isEbayConfigured()).toBe(false);
    expect(ebayProvider.isConfigured()).toBe(false);

    process.env.EBAY_CLIENT_ID = "test-client-id";
    expect(isEbayConfigured()).toBe(false);

    process.env.EBAY_CLIENT_SECRET = "test-client-secret";
    expect(isEbayConfigured()).toBe(true);

    clearCredentials();
    const fetchImpl = fakeFetch([]);
    await expect(ebayProvider.lookup(QUERY, fetchImpl)).resolves.toEqual([]);
    expect(calledUrls(fetchImpl)).toEqual([]);
  });
});

describe("eBay provider grade parsing", () => {
  it("keys grades the way summarize() expects", () => {
    expect(parseGrade("Charizard PSA 10 Gem Mint")).toBe("PSA 10");
    expect(parseGrade("Charizard BGS 9.5")).toBe("BGS 9.5");
    expect(parseGrade("Charizard CGC 10 Pristine")).toBe("CGC 10");
    expect(parseGrade("Charizard SGC 9")).toBe("SGC 9");
    expect(parseGrade("Charizard Grade 9")).toBe("Grade 9");
    expect(parseGrade("Charizard Base Set 4/102 Holo")).toBeNull();
  });
});

describe("eBay provider lookup", () => {
  it("returns median graded and ungraded prices from plausible sold listings", async () => {
    setCredentials();
    const fetchImpl = fakeFetch([
      ["api.ebay.com/identity", TOKEN_BODY],
      [
        "marketplace_insights",
        {
          total: 7,
          itemSales: [
            { itemId: "1", title: "Charizard Base Set 4/102 Holo", lastSoldPrice: { value: "100.00", currency: "USD" } },
            { itemId: "2", title: "Charizard Base Set 4/102 Near Mint", lastSoldPrice: { value: "150.00", currency: "USD" } },
            { itemId: "3", title: "Charizard Base Set 4/102", lastSoldPrice: { value: "200.00", currency: "USD" } },
            { itemId: "4", title: "Charizard Base Set PSA 10", lastSoldPrice: { value: "1000.00", currency: "USD" } },
            { itemId: "5", title: "Charizard Base Set 4/102 PSA 10 Gem Mint", lastSoldPrice: { value: "1200.00", currency: "USD" } },
            { itemId: "6", title: "Charizard Base Set BGS 9.5", lastSoldPrice: { value: "500.00", currency: "USD" } },
            { itemId: "7", title: "Pikachu Base Set PSA 10", lastSoldPrice: { value: "9999.00", currency: "USD" } },
          ],
        },
      ],
    ]);

    const quotes = await ebayProvider.lookup(QUERY, fetchImpl);

    const urls = calledUrls(fetchImpl);
    expect(urls.some((u) => u.includes("api.ebay.com/identity/v1/oauth2/token"))).toBe(true);
    expect(urls.some((u) => u.includes("marketplace_insights/v1_beta/item_sales/search"))).toBe(true);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      source: "ebay",
      sourceLabel: "eBay sold listings",
      currency: "USD",
      matchedName: "Charizard",
      // Median of 100 / 150 / 200; the Pikachu sale must not move any figure.
      ungraded: 150,
      graded: { "PSA 10": 1100, "BGS 9.5": 500 },
    });
  });

  it("surfaces an API error as a ProviderError", async () => {
    setCredentials();
    const fetchImpl = fakeFetch([
      ["api.ebay.com/identity", TOKEN_BODY],
      ["marketplace_insights", { errors: [{ message: "boom" }] }, 500],
    ]);

    const failure = await ebayProvider.lookup(QUERY, fetchImpl).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).source).toBe("ebay");
    expect((failure as ProviderError).message).toMatch(/HTTP 500/);
  });
});
