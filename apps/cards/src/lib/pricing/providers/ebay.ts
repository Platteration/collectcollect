import type { PriceQuote } from "../../types";
import type { CardQuery, PriceProvider } from "../types";
import { ProviderError } from "../types";
import { numberPart, round2, tokenOverlap, toNumber } from "../match";
import { rateLimit, retryAfterMs, type RateLimit } from "@collectcollect/core/limiter";

/**
 * eBay sold listings via the Marketplace Insights API
 * (https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html).
 * Requires an eBay developer keyset, EBAY_CLIENT_ID + EBAY_CLIENT_SECRET, whose
 * account eBay has approved for the API (it is a Limited Release) with the
 * `buy.marketplace.insights` scope. Inert without both values.
 *
 * The endpoint answers with items actually sold in the last 90 days, which is
 * noisier than a price guide's curated figure — a mis-titled listing, a lot,
 * or a shill bid all land in the same list — so each figure here is the
 * median of the plausible sales, never the mean, and a title that cannot be
 * read with confidence (see readTitle) is left out rather than guessed at.
 *
 * Not verified against a live account (none was available). eBay's reference
 * for item_sales/search marks `category_ids` as required and says an approved
 * partner is given the list of categories it may use, so there is no id that is
 * right for every account. This request therefore sends none, and eBay answers
 * HTTP 400 (error 100018) until one is added; that refusal is reported as such
 * (NEEDS_CATEGORY). The reference also says a space between keywords in `q` is
 * an OR and a comma an AND; the search text is still joined with spaces.
 */
const SOURCE = "ebay";

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SALES_URL = "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
/** eBay's reference makes this header required; the quotes are in dollars. */
const MARKETPLACE = "EBAY_US";
const SALES_LIMIT = 50;

/** eBay titles are at most 80 characters; a longer "title" is not one, and is not read. */
const MAX_TITLE_CHARS = 200;
/** One page is at most 200 items (the API's own limit); an answer with more is read only that far. */
const MAX_SALES = 200;
/** What is read of an answer: fifty sales are about 100 KB, so a megabyte is not a sales page. */
const MAX_SALES_BYTES = 1024 * 1024;
/** An access token or an error is a few hundred bytes. */
const MAX_SMALL_BYTES = 64 * 1024;

interface EbayCredentials {
  clientId: string;
  clientSecret: string;
}

export function ebayCredentials(): EbayCredentials | null {
  const clientId = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Key-gated: true only when both eBay credentials are set. */
export function isEbayConfigured(): boolean {
  return ebayCredentials() !== null;
}

// ---------------------------------------------------------------------------
// Pacing and the access token
// ---------------------------------------------------------------------------

/**
 * A refresh of the whole collection runs a few cards at once, so the pacing is
 * one shared queue for the whole process, like PriceCharting's, and the access
 * token (good for two hours) is kept for as long as eBay says it lasts. Both
 * live on the global object so a development reload does not forget them.
 */
interface HeldToken {
  /** Which keys it was issued to, so changing them does not reuse it. */
  basic: string;
  token: string;
  expiresAt: number;
}
const globalForEbay = globalThis as unknown as { __cardsEbayLimiter?: RateLimit; __cardsEbayToken?: HeldToken };
let limiter: RateLimit = (globalForEbay.__cardsEbayLimiter ??= rateLimit(1, 1000));

/** Tests only: replace the shared limit so a test does not wait a real second. */
export function setEbayLimit(next: RateLimit): void {
  limiter = globalForEbay.__cardsEbayLimiter = next;
}

/** Drop the held token; used when eBay refuses it, and by tests. */
export function forgetEbayToken(): void {
  delete globalForEbay.__cardsEbayToken;
}

/** The sign-in and search messages are this app's words, never eBay's: a connection test shows them as they stand. */
const NOT_APPROVED =
  "eBay refused these keys for Marketplace Insights. That API is a Limited Release: it answers only developer accounts eBay has approved for it, with their Production keys.";
const BAD_KEYS = "eBay refused the Client ID or Client Secret. Check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (the Production keyset, not Sandbox), then restart the app.";
const NEEDS_CATEGORY =
  "eBay refused the search: every Marketplace Insights search needs a category ID, from the list eBay gives an approved developer, and this app does not send one yet.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A response body as JSON, read no further than `max` bytes. A body that is
 * larger, or not JSON, is a ProviderError rather than a half-read answer.
 */
async function readJson(res: Response, max: number): Promise<unknown> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderError(SOURCE, "eBay answered with more than this app reads.");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel().catch(() => undefined);
          throw new ProviderError(SOURCE, "eBay answered with more than this app reads.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ProviderError(SOURCE, "eBay answered with something that is not JSON.");
  }
}

/** Held back for as long as eBay asks, for every lookup in the process. */
function rateLimited(res: Response): ProviderError {
  const wait = retryAfterMs(res.headers.get("retry-after"), Date.now(), 60_000);
  limiter.cooldown(wait);
  return new ProviderError(SOURCE, `eBay is rate limiting this app; every eBay lookup waits ${Math.ceil(wait / 1000)} seconds before asking again.`, 429);
}

/** Why eBay's token endpoint said no: `error` names it (invalid_client, invalid_scope), and nothing else is repeated. */
async function signInRefusal(res: Response): Promise<ProviderError> {
  if (res.status === 429) return rateLimited(res);
  const body = await readJson(res, MAX_SMALL_BYTES).catch(() => null);
  const code = isRecord(body) && typeof body.error === "string" ? body.error : null;
  if (code === "invalid_scope") return new ProviderError(SOURCE, NOT_APPROVED, 403);
  if (code === "invalid_client" || res.status === 401) return new ProviderError(SOURCE, BAD_KEYS, 401);
  return new ProviderError(SOURCE, `eBay OAuth returned HTTP ${res.status}`, res.status);
}

/** The error numbers of an eBay error answer: `{ errors: [{ errorId: 100018, ... }] }`. */
function errorIds(body: unknown): number[] {
  if (!isRecord(body) || !Array.isArray(body.errors)) return [];
  return body.errors.flatMap((e) => (isRecord(e) && Number.isInteger(Number(e.errorId)) ? [Number(e.errorId)] : []));
}

async function searchRefusal(res: Response): Promise<ProviderError> {
  if (res.status === 429) return rateLimited(res);
  if (res.status === 401) {
    // The held token is the likeliest reason: the next lookup asks for a fresh one.
    forgetEbayToken();
    return new ProviderError(SOURCE, BAD_KEYS, 401);
  }
  const ids = errorIds(await readJson(res, MAX_SMALL_BYTES).catch(() => null));
  // 100017: "Insufficient permissions to use this API."
  if (res.status === 403 || ids.includes(100017)) return new ProviderError(SOURCE, NOT_APPROVED, 403);
  // 100018: "This query requires at least one category."
  if (ids.includes(100018)) return new ProviderError(SOURCE, NEEDS_CATEGORY, 400);
  return new ProviderError(SOURCE, `eBay Marketplace Insights returned HTTP ${res.status}`, res.status);
}

async function accessToken(credentials: EbayCredentials, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<string> {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
  const held = globalForEbay.__cardsEbayToken;
  if (held && held.basic === basic && held.expiresAt > Date.now()) return held.token;
  let res: Response;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: OAUTH_SCOPE }).toString(),
      signal,
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(SOURCE, `eBay sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw await signInRefusal(res);
  const body = await readJson(res, MAX_SMALL_BYTES);
  const token = isRecord(body) && typeof body.access_token === "string" ? body.access_token : "";
  if (!token) throw new ProviderError(SOURCE, "eBay OAuth returned no access token");
  // Kept until a minute before eBay says it ends; an answer that says nothing usable is not kept at all.
  const seconds = isRecord(body) ? Number(body.expires_in) : Number.NaN;
  if (Number.isFinite(seconds) && seconds > 60) globalForEbay.__cardsEbayToken = { basic, token, expiresAt: Date.now() + (seconds - 60) * 1000 };
  return token;
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** The Marketplace Insights search text: name, set, and card number. */
export function buildQuery(q: CardQuery): string {
  const parts: string[] = [q.name];
  if (q.setName) parts.push(q.setName);
  const num = numberPart(q.cardNumber);
  if (num) parts.push(num);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function buildSalesUrl(q: CardQuery): string {
  const params = new URLSearchParams({ q: buildQuery(q), limit: String(SALES_LIMIT) });
  return `${SALES_URL}?${params}`;
}

// ---------------------------------------------------------------------------
// Reading a listing's title
// ---------------------------------------------------------------------------

/**
 * Why a title was not used. The seller wrote it, so nothing in it is trusted:
 * a sale whose grade cannot be read with confidence is not evidence for any
 * bucket, and putting it in the ungraded one (what reading no grade used to
 * mean) priced slabs, lots and guesses as raw cards.
 */
export type SkipReason = "hedged" | "lot" | "other-grader" | "grade-unclear" | "two-grades";

export type TitleReading =
  | { kind: "ungraded" }
  /** `grade` is keyed the way summarize() and PriceCharting key them: "PSA 10", "CGC 10 Pristine", "Grade 9". */
  | { kind: "graded"; grade: string }
  | { kind: "skip"; reason: SkipReason };

/** Letter runs, numbers (9.5), and the question marks that make a title a guess. Linear: no token overlaps another. */
const WORD = /[a-z]+|\d+(?:\.\d+)?|\?/g;
/** "x3" or "3x" standing alone; at most three digits, so the scan is bounded at each position. */
const MULTIPLE = /(?:^|[^a-z0-9])(?:x\d{1,3}|\d{1,3}x)(?![a-z0-9])/;

/** The four companies this app keys prices for. */
const KEYED_GRADERS = new Set(["psa", "bgs", "cgc", "sgc"]);
/** Companies it has no key for: a sale graded by one is neither a PSA 10 nor a raw card. */
const OTHER_GRADERS = new Set(["hga", "csg", "gma", "pcg", "fgs", "ags", "gai", "ksa", "beckett"]);
/** Also ordinary words in a card's title ("Tag Team", "Ace Spec"): a grader only with a grade after. */
const AMBIGUOUS_GRADERS = new Set(["tag", "ace"]);
/** A seller telling you what it might be, not what it is. */
const HEDGES = new Set([
  "candidate", "candidates", "potential", "ready", "raw", "not", "worthy", "quality", "pregrade", "gradable", "gradeable",
  "possible", "likely", "maybe", "looks",
]);
const LOT_WORDS = new Set(["lot", "lots", "bundle", "bundles", "bulk", "collection", "collections", "binder"]);
/** A slab with no company named: it is graded, and unkeyable. */
const SLAB_WORDS = new Set(["graded", "slab", "slabbed"]);
/**
 * The wording of a slab's label that can stand between a company and its
 * number ("PSA GEM MT 10", "BGS Black Label 10", "PSA MINT 9", "CGC Pristine
 * 10"). Any other word there leaves the grade unread, and the sale unused.
 */
const LABEL_WORDS = new Set([
  "grade", "graded", "gem", "mt", "mint", "gemmt", "gemmint", "nm", "near", "ex", "vg", "good", "poor", "pristine", "black", "gold", "label",
]);
const MAX_LABEL_WORDS = 5;

/** A grade as a company prints it: 1 to 10 in half steps. */
function gradeValue(word: string | undefined): number | null {
  if (word === undefined || !/^\d/.test(word)) return null;
  const n = Number(word);
  return Number.isFinite(n) && n >= 1 && n <= 10 && Number.isInteger(n * 2) ? n : null;
}

/** The grade written after the word at `from - 1`, past any label wording; null if what follows is not one. */
function gradeAfter(words: string[], from: number): number | null {
  for (let i = from; i < words.length && i < from + MAX_LABEL_WORDS + 1; i++) {
    const word = words[i]!;
    if (!LABEL_WORDS.has(word)) return gradeValue(word);
  }
  return null;
}

/** The label tier a title names, if any: the most specific when it names more than one. */
function tierOf(words: string[]): "Black Label" | "Pristine" | "Gold Label" | null {
  let pristine = false;
  let gold = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === "black" && words[i + 1] === "label") return "Black Label";
    if (word === "gold" && words[i + 1] === "label") gold = true;
    if (word === "pristine") pristine = true;
  }
  return pristine ? "Pristine" : gold ? "Gold Label" : null;
}

const skip = (reason: SkipReason): TitleReading => ({ kind: "skip", reason });

/**
 * What a sale's title says about the copy that sold, keyed the way summarize()
 * expects: "PSA 10", "BGS 9.5", "CGC 10", "SGC 9", "Grade 9" (a grade with no
 * company), and the tiers PriceCharting keys apart from the plain 10 — "CGC
 * 10 Pristine", "BGS 10 Black Label" — with "Gold Label" and the other
 * pairings keyed the same way, since they are different slabs worth different
 * prices. A title is used only when it reads one way:
 *
 *  - a guess ("PSA 10?", candidate, potential, ready, raw, not ...) is skipped;
 *  - a lot or bundle ("lot", "bundle", "x3") is skipped, from every bucket;
 *  - a company this app has no key for (TAG, ACE, HGA, CSG, Beckett ...) is
 *    skipped, as is a slab with no company, a company with no grade after it,
 *    a grade no company prints (SGC 98), or two readings;
 *  - what is left with no grading words is an ungraded copy.
 *
 * The title is split once into words, and every later step visits each word a
 * bounded number of times, so a long title costs a long scan and no more.
 */
export function readTitle(title: string): TitleReading {
  const lower = title.toLowerCase();
  const words = lower.match(WORD) ?? [];
  if (words.some((w) => w === "?" || HEDGES.has(w))) return skip("hedged");
  if (words.some((w) => LOT_WORDS.has(w)) || MULTIPLE.test(lower)) return skip("lot");

  // Each company named, with the grade after it.
  const readings = new Map<string, { company: string; grade: number }>();
  let unreadable = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (KEYED_GRADERS.has(word)) {
      const grade = gradeAfter(words, i + 1);
      if (grade === null) unreadable = true;
      else readings.set(`${word} ${grade}`, { company: word.toUpperCase(), grade });
    } else if (OTHER_GRADERS.has(word) || (AMBIGUOUS_GRADERS.has(word) && gradeAfter(words, i + 1) !== null)) {
      return skip("other-grader");
    }
  }
  const tier = tierOf(words);
  if (unreadable) return skip("grade-unclear");
  if (readings.size > 1) return skip("two-grades");
  const only = [...readings.values()][0];
  if (only) {
    // PSA has no tiers, and the pristine and black labels are 10s: any other pairing is a title that is wrong somewhere.
    if (tier !== null && (only.company === "PSA" || (tier !== "Gold Label" && only.grade !== 10))) return skip("grade-unclear");
    return { kind: "graded", grade: `${only.company} ${only.grade}${tier ? ` ${tier}` : ""}` };
  }

  // No company named: a bare "Grade 9", or nothing graded at all.
  const bare = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    if (words[i] === "grade" && /^\d/.test(words[i + 1] ?? "")) {
      const grade = gradeValue(words[i + 1]);
      if (grade === null) return skip("grade-unclear");
      bare.add(`Grade ${grade}`);
    }
  }
  if (bare.size > 1) return skip("two-grades");
  const grade = [...bare][0];
  if (grade) return tier === null ? { kind: "graded", grade } : skip("grade-unclear");
  if (words.some((w) => SLAB_WORDS.has(w))) return skip("grade-unclear");
  // "Gem Mint 10" on its own is a label with the company left off.
  for (let i = 0; i < words.length; i++) {
    const split = words[i] === "gem" && (words[i + 1] === "mint" || words[i + 1] === "mt");
    const joined = words[i] === "gemmint" || words[i] === "gemmt";
    if ((split && gradeValue(words[i + 2]) !== null) || (joined && gradeValue(words[i + 1]) !== null)) return skip("grade-unclear");
  }
  return { kind: "ungraded" };
}

// ---------------------------------------------------------------------------
// Sales to a quote
// ---------------------------------------------------------------------------

/** Median of a non-empty list, rounded to cents; null for an empty one. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return round2(value);
}

/**
 * A sold item as far as it can be trusted: a title short enough to be one, and
 * a dollar price. Marketplace Insights puts the price in `lastSoldPrice`
 * ({ value, currency }); a `price` of the same shape is tolerated.
 */
function readSale(raw: unknown): { title: string; price: number } | null {
  if (!isRecord(raw)) return null;
  const { title } = raw;
  if (typeof title !== "string" || title.length === 0 || title.length > MAX_TITLE_CHARS) return null;
  const amount = isRecord(raw.lastSoldPrice) ? raw.lastSoldPrice : isRecord(raw.price) ? raw.price : null;
  if (!amount) return null;
  const { currency, value } = amount;
  // The quote is USD; a sale priced in another currency is not evidence for it.
  if (currency !== undefined && currency !== null && currency !== "" && (typeof currency !== "string" || currency.toUpperCase() !== "USD")) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const price = toNumber(value);
  return price === null ? null : { title, price };
}

/** Whether a sale title plausibly names the card asked about. */
export function isPlausibleSale(q: CardQuery, title: string): boolean {
  return tokenOverlap(q.name, title) >= 0.5;
}

/**
 * Fold the plausible sales into one quote: the median ungraded price and the
 * median price per grade. Null when no sale is plausible, priced and readable.
 */
export function salesToQuote(q: CardQuery, sales: readonly unknown[], fetchedAt = new Date().toISOString()): PriceQuote | null {
  const ungradedPrices: number[] = [];
  const gradedPrices = new Map<string, number[]>();
  let used = 0;
  for (const raw of sales.slice(0, MAX_SALES)) {
    const sale = readSale(raw);
    if (!sale || !isPlausibleSale(q, sale.title)) continue;
    const reading = readTitle(sale.title);
    if (reading.kind === "skip") continue;
    used += 1;
    if (reading.kind === "ungraded") {
      ungradedPrices.push(sale.price);
    } else {
      const list = gradedPrices.get(reading.grade) ?? [];
      list.push(sale.price);
      gradedPrices.set(reading.grade, list);
    }
  }
  if (used === 0) return null;
  const graded: Record<string, number> = {};
  for (const [grade, prices] of gradedPrices) {
    const value = median(prices);
    if (value !== null) graded[grade] = value;
  }
  const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(buildQuery(q))}&LH_Sold=1&LH_Complete=1`;
  return {
    source: SOURCE,
    sourceLabel: "eBay sold listings",
    currency: "USD",
    url: searchUrl,
    matchedName: q.name,
    matchedDetail: `${used} sold listing${used === 1 ? "" : "s"} in the last 90 days`,
    ungraded: median(ungradedPrices),
    ungradedVariants: {},
    graded,
    fetchedAt,
  };
}

export const ebayProvider: PriceProvider = {
  id: SOURCE,
  label: "eBay sold listings",
  games: ["pokemon", "yugioh", "mtg", "sports", "other"],
  optional: true,
  note: "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (the Production keys of an eBay developer account approved for the Marketplace Insights API, a Limited Release) to price from sold listings of the last 90 days.",
  isConfigured: isEbayConfigured,
  async lookup(q, fetchImpl = fetch, signal?: AbortSignal) {
    const credentials = ebayCredentials();
    if (!credentials) return [];
    await limiter.take(signal);
    if (signal?.aborted) throw new ProviderError(SOURCE, "Gave up waiting for a turn to ask eBay.");
    const token = await accessToken(credentials, fetchImpl, signal);
    let res: Response;
    try {
      res = await fetchImpl(buildSalesUrl(q), {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE },
        signal,
      });
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(SOURCE, `eBay sold-listings request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw await searchRefusal(res);
    const body = await readJson(res, MAX_SALES_BYTES);
    const sales = isRecord(body) && Array.isArray(body.itemSales) ? body.itemSales : [];
    const quote = salesToQuote(q, sales);
    return quote ? [quote] : [];
  },
};
