import type { Game, PriceQuote } from "../../types";
import type { CardQuery, PriceProvider } from "../types";
import { ProviderError } from "../types";
import { numberPart, round2, sameNumber, setSimilarity, tokenOverlap, tokens } from "../match";
import {
  PriceChartingError,
  fetchProduct,
  isPriceChartingConfigured,
  priceChartingToken,
  productUrl,
  searchProducts,
  type PcProduct,
  type PcPriceField,
} from "@collectcollect/core/pricing/pricecharting";

/**
 * PriceCharting (https://www.pricecharting.com/api-documentation). Requires a
 * paid API token (PRICECHARTING_TOKEN). It is the one source here that reports
 * graded prices (PSA / BGS / CGC / SGC) and it covers Pokémon, Yu-Gi-Oh!,
 * Magic and sports cards alike, so when it is configured it is preferred.
 *
 * The HTTP client lives in the shared package, since a game or a comic is
 * priced from the same API; what stays here is what the price fields mean for
 * a trading card:
 *   loose-price -> Ungraded      cib-price -> Grade 7        new-price -> Grade 8
 *   graded-price -> Grade 9      box-only-price -> Grade 9.5  manual-only-price -> PSA 10
 *   bgs-10-price -> BGS 10       condition-17-price -> CGC 10  condition-18-price -> SGC 10
 */

export type { PcProduct };

const GRADED_FIELDS: Array<[PcPriceField, string]> = [
  ["cib-price", "Grade 7"],
  ["new-price", "Grade 8"],
  ["graded-price", "Grade 9"],
  ["box-only-price", "Grade 9.5"],
  ["manual-only-price", "PSA 10"],
  ["bgs-10-price", "BGS 10"],
  ["condition-17-price", "CGC 10"],
  ["condition-18-price", "SGC 10"],
];

export function buildSearch(q: CardQuery): string {
  const num = numberPart(q.cardNumber);
  const parts: string[] = [];
  if (q.game === "sports") {
    if (q.year) parts.push(String(q.year));
    if (q.manufacturer && !(q.setName ?? "").toLowerCase().includes(q.manufacturer.toLowerCase())) parts.push(q.manufacturer);
    if (q.setName) parts.push(q.setName);
    parts.push(q.name);
    if (num) parts.push(`#${num}`);
    // A named parallel is its own product on PriceCharting ("Gold Refractor"),
    // so it goes into the search; a plain variant word like "auto" does too.
    if (q.parallel) parts.push(q.parallel);
  } else {
    parts.push(q.name);
    if (num) parts.push(`#${num}`);
    if (q.setName) parts.push(q.setName);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const CATEGORY_HINTS: Record<Game, string[]> = {
  pokemon: ["pokemon"],
  yugioh: ["yugioh", "yu-gi-oh"],
  mtg: ["magic"],
  sports: ["baseball", "basketball", "football", "hockey", "soccer", "topps", "panini", "bowman", "upper", "fleer", "donruss", "wrestling", "golf", "racing", "ufc"],
  other: [],
};

export function scoreProduct(q: CardQuery, p: PcProduct): number {
  const productName = p["product-name"];
  const console = p["console-name"];
  let score = tokenOverlap(q.name, productName) * 4;
  const pnum = productName.match(/#\s*([A-Za-z0-9-]+)/)?.[1] ?? null;
  if (q.cardNumber) {
    if (sameNumber(q.cardNumber, pnum)) score += 3;
    else if (pnum) score -= 2;
  }
  if (q.setName) score += setSimilarity(q.setName, console.replace(/^(pokemon|yugioh|magic)\s+/i, "")) * 3;
  if (q.year && (console.includes(String(q.year)) || p["release-date"]?.startsWith(String(q.year)))) score += 1;
  if (q.manufacturer) score += tokenOverlap(q.manufacturer, console);
  const consoleTokens = new Set(tokens(console));
  if (CATEGORY_HINTS[q.game].some((h) => consoleTokens.has(h) || console.toLowerCase().includes(h))) score += 1;
  const v = `${q.variant ?? ""} ${q.parallel ?? ""}`.toLowerCase();
  const pn = productName.toLowerCase();
  for (const kw of ["reverse", "holo", "1st edition", "shadowless", "refractor", "auto", "foil", "parallel"]) {
    if (v.includes(kw) && pn.includes(kw)) score += 0.5;
    if (!v.includes(kw) && pn.includes(kw) && kw !== "holo") score -= 0.5;
  }
  // A parallel's own words ("gold", "prizm") count when the copy has them and against it when it does not.
  for (const word of tokens(q.parallel)) if (pn.includes(word)) score += 0.5;
  return score;
}

function cents(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? round2(n / 100) : null;
}

export function productToQuote(p: PcProduct, fetchedAt = new Date().toISOString()): PriceQuote {
  const graded: Record<string, number> = {};
  for (const [field, label] of GRADED_FIELDS) {
    const v = cents(p[field]);
    if (v) graded[label] = v;
  }
  return {
    source: "pricecharting",
    sourceLabel: "PriceCharting",
    currency: "USD",
    url: productUrl(p),
    matchedName: p["product-name"],
    matchedDetail: p["console-name"],
    ungraded: cents(p["loose-price"]),
    ungradedVariants: {},
    graded,
    fetchedAt,
    externalId: p.id,
  };
}

export const priceChartingProvider: PriceProvider = {
  id: "pricecharting",
  label: "PriceCharting",
  games: ["pokemon", "yugioh", "mtg", "sports", "other"],
  optional: true,
  note: "Set PRICECHARTING_TOKEN (paid API) to get graded PSA/BGS/CGC/SGC prices for every category. The only sports-card price source; there is no free sports API.",
  isConfigured: isPriceChartingConfigured,
  async lookup(q, fetchImpl = fetch) {
    const token = priceChartingToken();
    if (!token) return [];
    const knownId = q.externalIds?.pricecharting;
    if (knownId) {
      const product = await fetchProduct(token, knownId, fetchImpl);
      if (product) return [productToQuote(product)];
    }
    let products: PcProduct[];
    try {
      products = await searchProducts(token, buildSearch(q), fetchImpl);
    } catch (e) {
      if (e instanceof PriceChartingError) throw new ProviderError("pricecharting", e.message);
      throw e;
    }
    if (products.length === 0) return [];
    const ranked = products.map((p) => ({ p, s: scoreProduct(q, p) })).sort((a, b) => b.s - a.s);
    if (ranked[0].s < 1.5) return []; // nothing that plausibly matches
    return [productToQuote(ranked[0].p)];
  },
};
