import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ebayProvider,
  forgetEbayToken,
  isEbayConfigured,
  median,
  readTitle,
  salesToQuote,
  setEbayLimit,
} from "@/lib/pricing/providers/ebay";
import { PROVIDERS, providersFor, summarize } from "@/lib/pricing";
import { SOURCE_PRIORITY } from "@/lib/pricing/priority";
import { ProviderError } from "@/lib/pricing/types";
import { gradingOutlook } from "@/lib/analytics";
import { readPriceSummary } from "@/lib/price-summary";
import { DEFAULT_SETTINGS, type PriceQuote } from "@/lib/types";
import { NO_LIMIT, rateLimit } from "@collectcollect/core/limiter";
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

interface Answer {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

/**
 * A fetch that plays eBay: the token endpoint and the search each answer from
 * a function of how many times they have been asked, and every request is kept
 * with its headers.
 */
function ebayFetch(opts: { token?: (n: number) => Answer; search?: (n: number) => Answer } = {}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let tokens = 0;
  let searches = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    let answer: Answer;
    if (url.includes("identity/v1/oauth2/token")) answer = (opts.token ?? (() => ({ body: TOKEN_BODY })))((tokens += 1));
    else if (url.includes("marketplace_insights")) answer = (opts.search ?? (() => ({ body: { itemSales: [PLAIN_SALE] } })))((searches += 1));
    else answer = { body: {}, status: 404 };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "Content-Type": "application/json", ...answer.headers },
    });
  }) as typeof fetch;
  return { fetchImpl, calls, tokens: () => tokens, searches: () => searches };
}

const headersOf = (init: RequestInit | undefined) => new Headers(init?.headers);

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  clearCredentials();
  setEbayLimit(NO_LIMIT);
  forgetEbayToken();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.useRealTimers();
  setEbayLimit(NO_LIMIT);
  forgetEbayToken();
});

const TOKEN_BODY = { access_token: "test-token", token_type: "Application Access Token", expires_in: 7200 };
const PLAIN_SALE = { itemId: "1", title: "Charizard Base Set 4/102 Holo", lastSoldPrice: { value: "100.00", currency: "USD" } };

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

  it("is listed with the other price sources only while both credentials are set", () => {
    expect(PROVIDERS.map((p) => p.id)).toContain("ebay");
    expect(providersFor("pokemon").map((p) => p.id)).not.toContain("ebay");
    setCredentials();
    expect(providersFor("pokemon").map((p) => p.id)).toContain("ebay");
  });
});

/** The reading of a title as one short string: the grade key, "ungraded", or "skip:<why>". */
function read(title: string): string {
  const r = readTitle(title);
  return r.kind === "graded" ? r.grade : r.kind === "skip" ? `skip:${r.reason}` : "ungraded";
}

describe("reading a sold listing's title", () => {
  it("keys grades the way summarize() expects", () => {
    expect(read("Charizard PSA 10 Gem Mint")).toBe("PSA 10");
    expect(read("Charizard BGS 9.5")).toBe("BGS 9.5");
    expect(read("Charizard CGC 10")).toBe("CGC 10");
    expect(read("Charizard SGC 9")).toBe("SGC 9");
    expect(read("Charizard Grade 9")).toBe("Grade 9");
    expect(read("Charizard Base Set 4/102 Holo")).toBe("ungraded");
    // The company's number is read whole: 1 is not the start of 10, nor 9 of 9.5.
    expect(read("Charizard PSA 1")).toBe("PSA 1");
    expect(read("Charizard PSA 10")).toBe("PSA 10");
    expect(read("Charizard BGS 9")).toBe("BGS 9");
    expect(read("Charizard psa10")).toBe("PSA 10");
    expect(read("Charizard PSA 10.0")).toBe("PSA 10");
  });

  it("reads a slab's own label wording, which used to leave a real slab filed as ungraded", () => {
    expect(read("Charizard PSA GEM MT 10")).toBe("PSA 10");
    expect(read("Charizard PSA GEM-MT 10")).toBe("PSA 10");
    expect(read("Charizard PSA GEM MINT 10")).toBe("PSA 10");
    expect(read("Charizard PSA MINT 9")).toBe("PSA 9");
    expect(read("Charizard PSA 9 MINT")).toBe("PSA 9");
    expect(read("Charizard PSA NM-MT 8")).toBe("PSA 8");
    expect(read("Charizard BGS Gem Mint 9.5")).toBe("BGS 9.5");
    expect(read("Charizard SGC GEM MT 10")).toBe("SGC 10");
  });

  it("keys the pristine and label tiers apart from the plain 10, as PriceCharting does", () => {
    // These two were "CGC 10" and "BGS 10" before, which averaged them into a
    // different, cheaper slab's price.
    expect(read("Charizard CGC 10 Pristine")).toBe("CGC 10 Pristine");
    expect(read("Charizard CGC Pristine 10")).toBe("CGC 10 Pristine");
    expect(read("Charizard BGS 10 Black Label")).toBe("BGS 10 Black Label");
    expect(read("Charizard BGS Black Label 10")).toBe("BGS 10 Black Label");
    expect(read("Charizard BGS 10 Pristine Black Label")).toBe("BGS 10 Black Label");
    expect(read("Charizard BGS 10 Pristine")).toBe("BGS 10 Pristine");
    expect(read("Charizard BGS 10 Pristine Gold Label")).toBe("BGS 10 Pristine");
    expect(read("Charizard SGC 10 Gold Label")).toBe("SGC 10 Gold Label");
    expect(read("Charizard BGS 9.5 Gold Label")).toBe("BGS 9.5 Gold Label");
    // A tier the company does not have, or on a grade that cannot carry it, is a title that is wrong somewhere.
    expect(read("Charizard PSA 10 Pristine")).toBe("skip:grade-unclear");
    expect(read("Charizard BGS 9 Black Label")).toBe("skip:grade-unclear");
    expect(read("Charizard Grade 10 Pristine")).toBe("skip:grade-unclear");
    // The word alone, on a raw card, is a condition claim and not a slab.
    expect(read("Charizard Pristine Condition")).toBe("ungraded");
  });

  it("leaves out a title that guesses, whichever word gives it away", () => {
    expect(read("Charizard PSA 10 candidate raw")).toBe("skip:hedged");
    expect(read("Charizard Ready to grade 10?")).toBe("skip:hedged");
    expect(read("Charizard ungraded not PSA 10")).toBe("skip:hedged");
    expect(read("Charizard PSA 10?")).toBe("skip:hedged");
    expect(read("Charizard PSA 10 candidates")).toBe("skip:hedged");
    expect(read("Charizard potential PSA 10")).toBe("skip:hedged");
    expect(read("Charizard raw card")).toBe("skip:hedged");
    expect(read("Charizard ready for PSA")).toBe("skip:hedged");
    expect(read("Charizard gem mint quality")).toBe("skip:hedged");
    expect(read("Charizard PSA 10 worthy")).toBe("skip:hedged");
    expect(read("Charizard maybe PSA 9")).toBe("skip:hedged");
  });

  it("leaves out lots and bundles from every bucket", () => {
    expect(read("Lot of 10 Charizard cards")).toBe("skip:lot");
    expect(read("Charizard PSA 10 x3 lot")).toBe("skip:lot");
    expect(read("Charizard bundle")).toBe("skip:lot");
    expect(read("Charizard Bulk Holo")).toBe("skip:lot");
    expect(read("Charizard x2")).toBe("skip:lot");
    expect(read("Charizard 3x Holo")).toBe("skip:lot");
    expect(read("Pokemon Card Collection Charizard")).toBe("skip:lot");
    // Words that merely contain these are cards.
    expect(read("Black Lotus Alpha")).toBe("ungraded");
    expect(read("Charizard VMAX Holo")).toBe("ungraded");
    expect(read("Charizard Max Rare 10 of 100")).toBe("ungraded");
  });

  it("leaves out a company it has no price key for, rather than filing the slab as ungraded", () => {
    expect(read("Charizard TAG 10")).toBe("skip:other-grader");
    expect(read("Charizard TAG Grade 10")).toBe("skip:other-grader");
    expect(read("Charizard ACE 10")).toBe("skip:other-grader");
    expect(read("Charizard HGA 9.5")).toBe("skip:other-grader");
    expect(read("Charizard CSG 9")).toBe("skip:other-grader");
    expect(read("Charizard Beckett 9.5")).toBe("skip:other-grader");
    expect(read("Charizard GMA 8")).toBe("skip:other-grader");
    expect(read("Charizard PSA 10 and TAG 10")).toBe("skip:other-grader");
    // Card names that are the same words are not graders.
    expect(read("Pikachu & Zekrom TAG TEAM-GX 33/181")).toBe("ungraded");
    expect(read("Prime Catcher ACE SPEC 157/167")).toBe("ungraded");
  });

  it("leaves out a title whose grade it cannot read to one answer", () => {
    expect(read("Charizard PSA 10 BGS 9.5")).toBe("skip:two-grades");
    expect(read("Charizard PSA 10 PSA 9")).toBe("skip:two-grades");
    expect(read("Charizard PSA Authentic")).toBe("skip:grade-unclear");
    expect(read("Charizard PSA")).toBe("skip:grade-unclear");
    expect(read("Charizard PSA/DNA 10 Auto")).toBe("skip:grade-unclear");
    expect(read("Charizard PSA 12345678")).toBe("skip:grade-unclear");
    expect(read("Charizard SGC 98")).toBe("skip:grade-unclear");
    expect(read("Charizard PSA 9.25")).toBe("skip:grade-unclear");
    expect(read("Charizard CGC Perfect 10")).toBe("skip:grade-unclear");
    expect(read("Charizard Graded Holo")).toBe("skip:grade-unclear");
    expect(read("Charizard Gem Mint 10")).toBe("skip:grade-unclear");
    expect(read("Charizard Grade 12")).toBe("skip:grade-unclear");
    // A condition claim on a raw card is not a slab.
    expect(read("Charizard Gem Mint")).toBe("ungraded");
    expect(read("Charizard Near Mint")).toBe("ungraded");
    expect(read("Charizard Ungraded NM")).toBe("ungraded");
  });
});

describe("folding sold listings into a quote", () => {
  it("prices the review's listings by what each one is", () => {
    const sale = (title: string, value: string) => ({ title, lastSoldPrice: { value, currency: "USD" } });
    const quote = salesToQuote(
      QUERY,
      [
        sale("Charizard PSA 10?", "300.00"),
        sale("Charizard PSA 10 candidate raw", "320.00"),
        sale("Charizard PSA GEM MT 10", "9000.00"),
        sale("Charizard PSA GEM MT 10", "9200.00"),
        sale("Charizard Base Set", "350.00"),
        sale("Charizard CGC 10 Pristine", "15000.00"),
        sale("Lot of 10 Charizard cards", "80.00"),
        sale("Charizard TAG 10", "5000.00"),
      ],
      "2026-10-01T00:00:00.000Z",
    );
    // The two guesses, the lot and the TAG slab count for nothing; the real
    // PSA 10s are no longer ungraded; the Pristine is its own key.
    expect(quote).toMatchObject({
      ungraded: 350,
      graded: { "PSA 10": 9100, "CGC 10 Pristine": 15000 },
      matchedDetail: "4 sold listings in the last 90 days",
    });
    expect(quote?.graded).not.toHaveProperty("CGC 10");
  });

  it("has nothing to say when every listing is left out", () => {
    expect(salesToQuote(QUERY, [{ title: "Charizard PSA 10?", lastSoldPrice: { value: "300", currency: "USD" } }])).toBeNull();
    expect(salesToQuote(QUERY, [])).toBeNull();
  });

  it("takes the median, not the mean", () => {
    expect(median([1, 2, 100])).toBe(2);
    expect(median([1, 2, 3, 100])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("reads a response field by field, so an answer of the wrong shape is one with no sales", () => {
    const sales: unknown[] = [
      null,
      5,
      "Charizard",
      { title: 5, lastSoldPrice: { value: "10", currency: "USD" } },
      { title: "Charizard no price" },
      { title: "Charizard odd price", lastSoldPrice: { value: { a: 1 }, currency: "USD" } },
      { title: "Charizard odd currency", lastSoldPrice: { value: "10", currency: 5 } },
      { title: "Charizard euro", lastSoldPrice: { value: "10", currency: "EUR" } },
      { title: `Charizard ${"x".repeat(300)}`, lastSoldPrice: { value: "10", currency: "USD" } },
      { title: "Charizard Holo", lastSoldPrice: { value: "100.00", currency: "USD" } },
    ];
    expect(salesToQuote(QUERY, sales)).toMatchObject({ ungraded: 100, matchedDetail: "1 sold listing in the last 90 days" });
  });

  it("reads at most one page of sales", () => {
    const sales = [
      ...Array.from({ length: 200 }, () => ({ title: "Charizard Holo", lastSoldPrice: { value: "10", currency: "USD" } })),
      ...Array.from({ length: 300 }, () => ({ title: "Charizard Holo", lastSoldPrice: { value: "1000", currency: "USD" } })),
    ];
    expect(salesToQuote(QUERY, sales)).toMatchObject({ ungraded: 10, matchedDetail: "200 sold listings in the last 90 days" });
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
    expect((failure as ProviderError).message).not.toContain("boom");
  });

  it("asks the way eBay's reference says to: Basic keys for a token, then a Bearer token and the marketplace header", async () => {
    setCredentials();
    const { fetchImpl, calls } = ebayFetch();
    await ebayProvider.lookup(QUERY, fetchImpl);

    const [token, search] = calls;
    expect(token?.url).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    expect(token?.init?.method).toBe("POST");
    expect(headersOf(token?.init).get("authorization")).toBe(`Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`);
    const form = new URLSearchParams(String(token?.init?.body));
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe("https://api.ebay.com/oauth/api_scope/buy.marketplace.insights");

    const url = new URL(search?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search");
    expect(url.searchParams.get("q")).toBe("Charizard Base Set 4");
    expect(url.searchParams.get("limit")).toBe("50");
    const headers = headersOf(search?.init);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    // eBay answers HTTP 400 (error 100020) without it.
    expect(headers.get("x-ebay-c-marketplace-id")).toBe("EBAY_US");
  });
});

describe("eBay's access token", () => {
  it("is asked for once and reused while it lasts, not once per card", async () => {
    setCredentials();
    const { fetchImpl, tokens, searches } = ebayFetch();
    await ebayProvider.lookup(QUERY, fetchImpl);
    await ebayProvider.lookup({ ...QUERY, name: "Blastoise" }, fetchImpl);
    await ebayProvider.lookup({ ...QUERY, name: "Venusaur" }, fetchImpl);
    expect(tokens()).toBe(1);
    expect(searches()).toBe(3);
  });

  it("is asked for again a minute before eBay says it ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    setCredentials();
    const { fetchImpl, tokens } = ebayFetch();
    await ebayProvider.lookup(QUERY, fetchImpl);
    // expires_in is 7200 s: held until 7140 s.
    vi.setSystemTime(new Date("2026-10-01T01:58:59Z"));
    await ebayProvider.lookup(QUERY, fetchImpl);
    expect(tokens()).toBe(1);
    vi.setSystemTime(new Date("2026-10-01T01:59:01Z"));
    await ebayProvider.lookup(QUERY, fetchImpl);
    expect(tokens()).toBe(2);
  });

  it("is not kept when eBay says nothing usable about how long it lasts", async () => {
    setCredentials();
    const noLife = ebayFetch({ token: () => ({ body: { access_token: "t" } }) });
    await ebayProvider.lookup(QUERY, noLife.fetchImpl);
    await ebayProvider.lookup(QUERY, noLife.fetchImpl);
    expect(noLife.tokens()).toBe(2);

    forgetEbayToken();
    const nearlyOver = ebayFetch({ token: () => ({ body: { access_token: "t", expires_in: 30 } }) });
    await ebayProvider.lookup(QUERY, nearlyOver.fetchImpl);
    await ebayProvider.lookup(QUERY, nearlyOver.fetchImpl);
    expect(nearlyOver.tokens()).toBe(2);
  });

  it("is not reused for other keys", async () => {
    setCredentials();
    const { fetchImpl, tokens } = ebayFetch();
    await ebayProvider.lookup(QUERY, fetchImpl);
    process.env.EBAY_CLIENT_SECRET = "another-secret";
    await ebayProvider.lookup(QUERY, fetchImpl);
    expect(tokens()).toBe(2);
  });

  it("is dropped when eBay refuses it, so the next lookup signs in again", async () => {
    setCredentials();
    const { fetchImpl, tokens } = ebayFetch({ search: (n) => (n === 1 ? { body: { errors: [] }, status: 401 } : { body: { itemSales: [PLAIN_SALE] } }) });
    await expect(ebayProvider.lookup(QUERY, fetchImpl)).rejects.toMatchObject({ source: "ebay", status: 401 });
    await expect(ebayProvider.lookup(QUERY, fetchImpl)).resolves.toHaveLength(1);
    expect(tokens()).toBe(2);
  });
});

describe("eBay's pace", () => {
  it("is one search a second across the process, and a refusal holds every lookup back for as long as eBay asks", async () => {
    setCredentials();
    let now = 0;
    const sleeps: number[] = [];
    setEbayLimit(rateLimit(1, 1000, { now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } }));
    const ok = ebayFetch();
    await ebayProvider.lookup(QUERY, ok.fetchImpl);
    await ebayProvider.lookup(QUERY, ok.fetchImpl);
    // The second lookup waited out the second the first one started.
    expect(sleeps).toEqual([1000]);
    now += 1000;
    const refusing = ebayFetch({ search: () => ({ body: {}, status: 429, headers: { "retry-after": "30" } }) });
    const failure = await ebayProvider.lookup(QUERY, refusing.fetchImpl).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).status).toBe(429);
    expect((failure as ProviderError).message).toMatch(/eBay is rate limiting this app; every eBay lookup waits 30 seconds/);
    now += 1000;
    await ebayProvider.lookup(QUERY, ok.fetchImpl);
    // Past the per-second window but inside the pause eBay asked for: the rest of it is waited out.
    expect(sleeps).toEqual([1000, 29000]);
  });

  it("gives up on a lookup whose deadline passed while it waited for its turn", async () => {
    setCredentials();
    const { fetchImpl, calls } = ebayFetch();
    const deadline = new AbortController();
    deadline.abort();
    await expect(ebayProvider.lookup(QUERY, fetchImpl, deadline.signal)).rejects.toThrow(/Gave up waiting for a turn to ask eBay/);
    expect(calls).toEqual([]);
  });

  it("hands the caller's deadline to both requests", async () => {
    setCredentials();
    const { fetchImpl, calls } = ebayFetch();
    const deadline = new AbortController();
    await ebayProvider.lookup(QUERY, fetchImpl, deadline.signal);
    expect(calls.map((c) => c.init?.signal)).toEqual([deadline.signal, deadline.signal]);
  });
});

describe("what eBay's refusals say", () => {
  const secret = "SECRET-FROM-EBAY-BODY";

  it("names the approval eBay's Marketplace Insights needs when sign-in refuses the scope", async () => {
    setCredentials();
    const { fetchImpl } = ebayFetch({ token: () => ({ status: 400, body: { error: "invalid_scope", error_description: secret } }) });
    const failure = (await ebayProvider.lookup(QUERY, fetchImpl).catch((err: unknown) => err)) as ProviderError;
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure.status).toBe(403);
    expect(failure.message).toMatch(/Limited Release/);
    expect(failure.message).toMatch(/approved/);
    expect(failure.message).not.toContain(secret);
  });

  it("tells wrong keys from a missing approval", async () => {
    setCredentials();
    const wrong = ebayFetch({ token: () => ({ status: 401, body: { error: "invalid_client", error_description: secret } }) });
    const failure = (await ebayProvider.lookup(QUERY, wrong.fetchImpl).catch((err: unknown) => err)) as ProviderError;
    expect(failure.status).toBe(401);
    expect(failure.message).toMatch(/EBAY_CLIENT_ID and EBAY_CLIENT_SECRET/);
    expect(failure.message).not.toContain(secret);
    expect(failure.message).not.toMatch(/Limited Release/);
  });

  it("says the same about a search that is refused for permission", async () => {
    setCredentials();
    for (const refusal of [
      { status: 403, body: { errors: [{ errorId: 1100, message: secret }] } },
      { status: 400, body: { errors: [{ errorId: 100017, message: secret }] } },
    ]) {
      forgetEbayToken();
      const { fetchImpl } = ebayFetch({ search: () => refusal });
      const failure = (await ebayProvider.lookup(QUERY, fetchImpl).catch((err: unknown) => err)) as ProviderError;
      expect(failure.status).toBe(403);
      expect(failure.message).toMatch(/Limited Release/);
      expect(failure.message).not.toContain(secret);
    }
  });

  it("says a search with no category is what eBay refused, since this app sends none", async () => {
    setCredentials();
    const { fetchImpl } = ebayFetch({ search: () => ({ status: 400, body: { errors: [{ errorId: 100018, message: secret }] } }) });
    const failure = (await ebayProvider.lookup(QUERY, fetchImpl).catch((err: unknown) => err)) as ProviderError;
    expect(failure.status).toBe(400);
    expect(failure.message).toMatch(/needs a category ID/);
    expect(failure.message).not.toContain(secret);
  });

  it("reports any other refusal by its status alone", async () => {
    setCredentials();
    const oauth = ebayFetch({ token: () => ({ status: 503, body: { error: "temporarily_unavailable", error_description: secret } }) });
    await expect(ebayProvider.lookup(QUERY, oauth.fetchImpl)).rejects.toMatchObject({ message: "eBay OAuth returned HTTP 503", status: 503 });
    const search = ebayFetch({ search: () => ({ status: 400, body: { errors: [{ errorId: 100010, message: secret }] } }) });
    await expect(ebayProvider.lookup(QUERY, search.fetchImpl)).rejects.toMatchObject({ message: "eBay Marketplace Insights returned HTTP 400", status: 400 });
  });

  it("is a ProviderError when the answer has no token, is not JSON, or is more than a sales page", async () => {
    setCredentials();
    const noToken = ebayFetch({ token: () => ({ body: { token_type: "x" } }) });
    await expect(ebayProvider.lookup(QUERY, noToken.fetchImpl)).rejects.toThrow(/returned no access token/);

    const notJson = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes("identity") ? new Response(JSON.stringify(TOKEN_BODY)) : new Response("<html>maintenance</html>", { status: 200 });
    }) as typeof fetch;
    await expect(ebayProvider.lookup(QUERY, notJson)).rejects.toThrow(/not JSON/);

    forgetEbayToken();
    const huge = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      // No content-length: the cap is on the bytes that arrive.
      return url.includes("identity") ? new Response(JSON.stringify(TOKEN_BODY)) : new Response(`{"itemSales":[],"pad":"${"x".repeat(1024 * 1024 + 1)}"}`);
    }) as typeof fetch;
    await expect(ebayProvider.lookup(QUERY, huge)).rejects.toThrow(/more than this app reads/);

    forgetEbayToken();
    const declared = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes("identity") ? new Response(JSON.stringify(TOKEN_BODY)) : new Response("{}", { headers: { "content-length": String(50 * 1024 * 1024) } });
    }) as typeof fetch;
    await expect(ebayProvider.lookup(QUERY, declared)).rejects.toThrow(/more than this app reads/);
  });

  it("treats an answer whose sales are not a list as having none", async () => {
    setCredentials();
    const { fetchImpl } = ebayFetch({ search: () => ({ body: { itemSales: "none" } }) });
    await expect(ebayProvider.lookup(QUERY, fetchImpl)).resolves.toEqual([]);
    const array = ebayFetch({ search: () => ({ body: [] }) });
    await expect(ebayProvider.lookup(QUERY, array.fetchImpl)).resolves.toEqual([]);
  });
});

describe("eBay in the rest of the app", () => {
  const quote = (source: PriceQuote["source"], sourceLabel: string, patch: Partial<PriceQuote>): PriceQuote => ({
    source,
    sourceLabel,
    currency: "USD",
    url: null,
    matchedName: "Charizard",
    matchedDetail: null,
    ungraded: null,
    ungradedVariants: {},
    graded: {},
    fetchedAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  });
  const copy = { condition: "NM" as const, gradingCompany: null, grade: null };

  it("ranks every price source, so none sorts ahead of the owner's own price", () => {
    for (const p of PROVIDERS) expect(SOURCE_PRIORITY, p.id).toContain(p.id);
    expect(SOURCE_PRIORITY[0]).toBe("manual");
    // The providers are listed in the order they win an ungraded price, and so is this.
    expect(SOURCE_PRIORITY.slice(1)).toEqual(PROVIDERS.map((p) => p.id));
  });

  it("averages a graded price eBay and PriceCharting both report, and names both", () => {
    const summary = summarize(
      [
        quote("pricecharting", "PriceCharting", { ungraded: 100, graded: { "PSA 10": 4000 } }),
        quote("ebay", "eBay sold listings", { ungraded: 90, graded: { "PSA 10": 5000 } }),
      ],
      [],
      DEFAULT_SETTINGS,
      { condition: "NM", gradingCompany: "PSA", grade: "10" },
    );
    expect(summary.graded["PSA 10"]).toBe(4500);
    expect(summary.ungraded).toBe(100);
    expect(summary.yourCopyBasis).toBe("PSA 10 price, average of 2 sources (PriceCharting + eBay sold listings).");
  });

  it("credits a bound to PriceCharting, not eBay, when both report the same figure", () => {
    // eBay is first in the list; before it had a rank it sorted ahead of everything.
    const summary = summarize(
      [
        quote("ebay", "eBay sold listings", { ungraded: 100, graded: { "PSA 10": 900 } }),
        quote("pricecharting", "PriceCharting", { ungraded: 100, graded: { "PSA 10": 900 } }),
      ],
      [],
      DEFAULT_SETTINGS,
      copy,
    );
    expect(gradingOutlook(summary, DEFAULT_SETTINGS)?.provenance).toMatchObject({ max: "observed", maxSource: "PriceCharting" });
  });

  it("keeps an eBay quote when a stored price summary is read back", () => {
    const stored = {
      fetchedAt: "2026-10-01T00:00:00.000Z",
      ungraded: 150,
      graded: { "PSA 10": 1100 },
      quotes: [quote("ebay", "eBay sold listings", { ungraded: 150, graded: { "PSA 10": 1100 } })],
    };
    const read = readPriceSummary(stored, "2026-10-01T00:00:00.000Z");
    expect(read?.quotes.map((q) => q.source)).toEqual(["ebay"]);
    expect(read?.quotes[0]).toMatchObject({ sourceLabel: "eBay sold listings", graded: { "PSA 10": 1100 } });
  });
});
