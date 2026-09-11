import type { Game, PriceQuote } from "../../types";
import { has } from "../../types";
import type { CardQuery, PriceProvider } from "../types";
import { ProviderError } from "../types";
import { numberPart, round2, sameNumber, setSimilarity, tokenOverlap, tokens } from "../match";

/**
 * PriceCharting (https://www.pricecharting.com/api-documentation). Requires a
 * paid API token (PRICECHARTING_TOKEN). It is the one source here that reports
 * graded prices (PSA / BGS / CGC / SGC) and it covers Pokémon, Yu-Gi-Oh!,
 * Magic and sports cards alike, so when it is configured it is preferred.
 *
 * Prices come back in cents. For trading cards the legacy video-game field
 * names map to grades as follows:
 *   loose-price -> Ungraded      cib-price -> Grade 7        new-price -> Grade 8
 *   graded-price -> Grade 9      box-only-price -> Grade 9.5  manual-only-price -> PSA 10
 *   bgs-10-price -> BGS 10       condition-17-price -> CGC 10  condition-18-price -> SGC 10
 */

export interface PcProduct {
  id: string;
  "product-name": string;
  "console-name": string;
  "release-date"?: string;
  "loose-price"?: number;
  "cib-price"?: number;
  "new-price"?: number;
  "graded-price"?: number;
  "box-only-price"?: number;
  "manual-only-price"?: number;
  "bgs-10-price"?: number;
  "condition-17-price"?: number;
  "condition-18-price"?: number;
}

const GRADED_FIELDS: Array<[keyof PcProduct, string]> = [
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
  // Own-property lookup: q.game comes off a card row, and a bare index that
  // lands on Object.prototype hands .some() to a value that has no such method.
  const hints = has(CATEGORY_HINTS, q.game) ? CATEGORY_HINTS[q.game] : [];
  if (hints.some((h) => consoleTokens.has(h) || console.toLowerCase().includes(h))) score += 1;
  const v = (q.variant ?? "").toLowerCase();
  const pn = productName.toLowerCase();
  for (const kw of ["reverse", "holo", "1st edition", "shadowless", "refractor", "auto", "foil", "parallel"]) {
    if (v.includes(kw) && pn.includes(kw)) score += 0.5;
    if (!v.includes(kw) && pn.includes(kw) && kw !== "holo") score -= 0.5;
  }
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
    url: `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(`${p["product-name"]} ${p["console-name"]}`)}`,
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
  note: "Set PRICECHARTING_TOKEN (paid API) to get graded PSA/BGS/CGC/SGC prices for every category.",
  isConfigured: () => Boolean(process.env.PRICECHARTING_TOKEN),
  async lookup(q, fetchImpl = fetch) {
    const token = process.env.PRICECHARTING_TOKEN;
    if (!token) return [];
    const knownId = q.externalIds?.pricecharting;
    if (knownId) {
      const res = await fetchImpl(`https://www.pricecharting.com/api/product?t=${encodeURIComponent(token)}&id=${encodeURIComponent(knownId)}`);
      if (res.ok) {
        const body = (await res.json()) as PcProduct & { status?: string };
        if (body.status === "success" && body["product-name"]) return [productToQuote(body)];
      }
    }
    const res = await fetchImpl(`https://www.pricecharting.com/api/products?t=${encodeURIComponent(token)}&q=${encodeURIComponent(buildSearch(q))}`);
    if (!res.ok) throw new ProviderError("pricecharting", `PriceCharting returned HTTP ${res.status}`);
    const body = (await res.json()) as { status?: string; products?: PcProduct[]; "error-message"?: string };
    if (body.status && body.status !== "success") {
      throw new ProviderError("pricecharting", body["error-message"] ?? `PriceCharting error: ${body.status}`);
    }
    const products = body.products ?? [];
    if (products.length === 0) return [];
    const ranked = products.map((p) => ({ p, s: scoreProduct(q, p) })).sort((a, b) => b.s - a.s);
    if (ranked[0].s < 1.5) return []; // nothing that plausibly matches
    return [productToQuote(ranked[0].p)];
  },
};
