// Shared domain types for the card catalog.

export type Game = "pokemon" | "yugioh" | "mtg" | "sports" | "other";

export const GAMES: Record<Game, string> = {
  pokemon: "Pokémon",
  yugioh: "Yu-Gi-Oh!",
  mtg: "Magic: The Gathering",
  sports: "Sports",
  other: "Other",
};

export const GAME_IDS = Object.keys(GAMES) as Game[];

/** Raw (ungraded) condition scale used by most marketplaces. */
export type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";

export const CONDITIONS: Record<Condition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "TAG", "Other"] as const;

/** Where a raw card stands in the owner's grading plans. */
export type GradingStatus = "undecided" | "planned" | "submitted" | "keep_raw";

export const GRADING_STATUSES: Record<GradingStatus, string> = {
  undecided: "Undecided",
  planned: "Plan to grade",
  submitted: "At the grader",
  keep_raw: "Keeping raw",
};

/** What the vision model reports about a single photographed card. */
export interface Identification {
  game: Game;
  sport: string | null;
  name: string;
  set_name: string | null;
  set_code: string | null;
  card_number: string | null;
  year: number | null;
  rarity: string | null;
  variant: string | null;
  language: string | null;
  manufacturer: string | null;
  subject: string | null;
  /** Sports cards: absent on identifications made before these existed. */
  team?: string | null;
  rookie?: boolean | null;
  parallel?: string | null;
  serial_number?: string | null;
  autograph?: boolean | null;
  relic?: boolean | null;
  grading: {
    company: string | null;
    grade: string | null;
    cert_number: string | null;
    /** BGS subgrades read off the label. */
    subgrades?: Subgrades | null;
  };
  condition_notes: string | null;
  /** Condition read from the photo; absent on identifications made before this existed. */
  condition_assessment?: {
    centering: string | null;
    corners: string | null;
    edges: string | null;
    surface: string | null;
    estimated_grade_low: string | null;
    estimated_grade_high: string | null;
    caveat: string | null;
  } | null;
  confidence: number;
  alternatives: Array<{
    name: string;
    set_name: string | null;
    card_number: string | null;
    reason: string;
  }>;
  search_query: string;
}

/** BGS grades each of the four aspects on its label. */
export interface Subgrades {
  centering: number | null;
  corners: number | null;
  edges: number | null;
  surface: number | null;
}

export const SUBGRADE_KEYS = ["centering", "corners", "edges", "surface"] as const;

/** `C 9.5 · Co 9 · E 9.5 · S 10` */
export function subgradesLabel(s: Subgrades | null | undefined): string {
  if (!s) return "";
  const short: Record<keyof Subgrades, string> = { centering: "C", corners: "Co", edges: "E", surface: "S" };
  return SUBGRADE_KEYS.filter((k) => s[k] !== null).map((k) => `${short[k]} ${s[k]}`).join(" · ");
}

/** Flags arrive as booleans from the form, 0/1 from the database, and "yes", "RC" or "x" from a spreadsheet. */
export const flag = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "x", "rc", "auto", "relic", "✓"].includes(s);
};
/** "12/99" however it was typed: "12 / 99", "12 of 99", "#12/99". */
export const serial = (v: unknown): string | null => {
  const s = v === null || v === undefined ? null : String(v).trim() || null;
  if (!s) return null;
  const m = s.match(/^#?\s*(\d+)\s*(?:\/|of)\s*(\d+)$/i);
  return m ? `${m[1]}/${m[2]}` : s;
};
/** Subgrades are numbers on the 10-point scale or absent; a set with nothing in it is no set at all. */
export function cleanSubgrades(input: unknown): Subgrades | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const out: Subgrades = { centering: null, corners: null, edges: null, surface: null };
  let any = false;
  for (const key of SUBGRADE_KEYS) {
    const n = raw[key] === null || raw[key] === undefined || raw[key] === "" ? null : Number(raw[key]);
    if (n !== null && !Number.isFinite(n)) continue;
    if (n !== null && n >= 1 && n <= 10) {
      out[key] = n;
      any = true;
    }
  }
  return any ? out : null;
}

export interface CardRecord {
  id: number;
  game: Game;
  sport: string | null;
  name: string;
  setName: string | null;
  setCode: string | null;
  cardNumber: string | null;
  year: number | null;
  rarity: string | null;
  variant: string | null;
  language: string | null;
  manufacturer: string | null;
  /** Sports cards: the team, whether it is a rookie card, the parallel or refractor, and the serial numbering ("12/99"). */
  team: string | null;
  rookie: boolean;
  parallel: string | null;
  serialNumber: string | null;
  autograph: boolean;
  relic: boolean;
  quantity: number;
  condition: Condition;
  gradingCompany: string | null;
  grade: string | null;
  certNumber: string | null;
  /** BGS subgrades, when the slab carries them. */
  subgrades: Subgrades | null;
  purchasePrice: number | null;
  notes: string | null;
  imagePath: string | null;
  referenceImageUrl: string | null;
  /** Average colour of the card art (#rrggbb), used to tint its page. */
  accentColor: string | null;
  /** Where the physical card is kept, e.g. "Binder 2, page 4" or "Box A". */
  location: string | null;
  externalIds: Record<string, string>;
  identification: Identification | null;
  manualUngraded: number | null;
  manualGraded: Record<string, number>;
  gradingStatus: GradingStatus;
  createdAt: string;
  updatedAt: string;
}

/** Fields a client may send when creating or updating a card. */
export type CardInput = Partial<
  Omit<CardRecord, "id" | "createdAt" | "updatedAt">
> & { game: Game; name: string };

export type PriceSource =
  | "pricecharting"
  | "pokemontcg"
  | "ygoprodeck"
  | "scryfall"
  | "manual";

export type Currency = "USD" | "EUR";

/** One provider's answer for one card. */
export interface PriceQuote {
  source: PriceSource;
  sourceLabel: string;
  currency: Currency;
  url: string | null;
  matchedName: string;
  matchedDetail: string | null;
  /** Market price for an ungraded ("raw") copy. */
  ungraded: number | null;
  /** Other raw prices the provider exposes, e.g. holofoil vs. normal. */
  ungradedVariants: Record<string, number>;
  /** Prices for graded copies, keyed like "PSA 10", "BGS 9.5", "Grade 9". */
  graded: Record<string, number>;
  fetchedAt: string;
  /** Provider-specific id so later refreshes can go straight to the product. */
  externalId?: string;
  referenceImageUrl?: string | null;
}

/** Consolidated view the UI shows; stored as a snapshot per refresh. */
export interface PriceSummary {
  currency: "USD";
  fetchedAt: string;
  ungraded: number | null;
  ungradedSource: string | null;
  graded: Record<string, number>;
  gradedSource: string | null;
  /** Estimates derived from the ungraded price via settings multipliers. */
  estimatedGraded: Record<string, number>;
  /** Value of the user's specific copy (their grade/condition), and how it was derived. */
  yourCopyValue: number | null;
  yourCopyBasis: string;
  quotes: PriceQuote[];
  errors: Array<{ source: string; message: string }>;
}

export interface Sale {
  id: number;
  cardId: number;
  quantity: number;
  /** What each copy sold for, before fees. */
  unitPrice: number;
  /** Marketplace and shipping fees for the whole sale. */
  fees: number;
  /** Cost basis per copy, captured at sale time so later edits don't rewrite history. */
  unitCost: number | null;
  soldAt: string;
  venue: string | null;
  notes: string | null;
  createdAt: string;
}

/** A sale joined to the card it came from, for lists that span cards. */
export interface SaleWithCard extends Sale {
  cardName: string;
  cardDetail: string;
  game: Game;
}

export type AlertKind = "ready_to_grade" | "price_move" | "graded_data";

export interface Alert {
  id: number;
  kind: AlertKind;
  cardId: number | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export type SubmissionStatus = "draft" | "sent" | "returned";

export const SUBMISSION_STATUSES: Record<SubmissionStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  returned: "Returned",
};

export interface SubmissionCard {
  cardId: number;
  /** Value of the raw copy when it was added to the submission. */
  rawValue: number | null;
  /** What a gem-mint outcome was worth at that moment. */
  expectedValue: number | null;
  returnedGrade: string | null;
  /** Value at the returned grade, captured when the grades were entered. */
  returnedValue: number | null;
  name: string;
  detail: string;
  game: Game;
  imagePath: string | null;
  referenceImageUrl: string | null;
}

export interface Submission {
  id: number;
  name: string;
  company: string;
  serviceLevel: string | null;
  feePerCard: number;
  shipping: number;
  status: SubmissionStatus;
  sentAt: string | null;
  returnedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cards: SubmissionCard[];
}

export interface PriceSnapshot {
  id: number;
  cardId: number;
  fetchedAt: string;
  summary: PriceSummary;
}

export interface Settings {
  /** Multiplier applied to the ungraded price to estimate a graded price. */
  gradeMultipliers: Record<string, number>;
  /** Multiplier applied to the ungraded (NM) price for a raw copy in this condition. */
  conditionMultipliers: Record<Condition, number>;
  /** What it costs to get one card graded (fee + shipping), used in the grading outlook. */
  gradingFee: number;
  /** A raw card counts as "ready to grade" when its upside clears both of these. */
  readyMinUpside: number;
  readyMinUpsidePercent: number;
  /** Shown on the printable appraisal report. */
  ownerName: string;
  /** Raise a price-move alert when a card's value changes by at least this much between refreshes. */
  alertMovePercent: number;
  /** Optional URL that new alerts are POSTed to, for wiring up email or push. */
  alertWebhookUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  gradeMultipliers: {
    "PSA 10": 3.0,
    "PSA 9": 1.4,
    "PSA 8": 1.0,
    "PSA 7": 0.8,
    "BGS 10": 5.0,
    "BGS 9.5": 2.5,
    "BGS 9": 1.3,
    "CGC 10": 3.0,
    "CGC 9.5": 2.0,
    "CGC 9": 1.2,
    "SGC 10": 2.5,
    "SGC 9": 1.2,
  },
  conditionMultipliers: {
    NM: 1.0,
    LP: 0.85,
    MP: 0.7,
    HP: 0.5,
    DMG: 0.3,
  },
  gradingFee: 25,
  readyMinUpside: 40,
  readyMinUpsidePercent: 50,
  ownerName: "",
  alertMovePercent: 15,
  alertWebhookUrl: "",
};

export interface ProviderStatus {
  id: PriceSource | "claude";
  label: string;
  configured: boolean;
  optional: boolean;
  games: Game[];
  note: string;
}
