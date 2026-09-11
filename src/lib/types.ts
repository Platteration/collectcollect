// Shared domain types for the card catalog.

/**
 * Own-property membership, which is how every whitelist in this app is tested.
 *
 * `key in TABLE` and a bare `TABLE[key]` both walk the prototype chain, so
 * `__proto__`, `constructor` and `toString` all read as valid names on a plain
 * object. A card whose game is `__proto__` is then stored, and `GAMES[game]`
 * renders as Object.prototype, which React refuses as a child: one request
 * turns every page into a 500 for good.
 */
export function has<T extends object>(table: T, key: unknown): key is keyof T {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key);
}

/**
 * A table's label for `key`, falling back to the raw value. Rows written before
 * the whitelists were tightened, or installed by a restore, can still hold
 * anything: a card the owner needs to find and delete must render, not throw.
 */
export function label<T extends Record<string, string>>(table: T, key: string): string {
  return has(table, key) ? table[key] : key;
}

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
  grading: {
    company: string | null;
    grade: string | null;
    cert_number: string | null;
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
  quantity: number;
  condition: Condition;
  gradingCompany: string | null;
  grade: string | null;
  certNumber: string | null;
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

export const ALERT_KINDS: Record<AlertKind, string> = {
  ready_to_grade: "Ready to grade",
  price_move: "Price move",
  graded_data: "Graded data",
};

export interface Alert {
  id: number;
  /**
   * What this app writes is always an AlertKind, but a row read back may not be:
   * a restored database can hold anything, so the sinks that render it guard it
   * with has()/label() rather than trusting a cast that was never checked.
   */
  kind: AlertKind | (string & {});
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
