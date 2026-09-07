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
  grading: {
    company: string | null;
    grade: string | null;
    cert_number: string | null;
  };
  condition_notes: string | null;
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
};

export interface ProviderStatus {
  id: PriceSource | "claude";
  label: string;
  configured: boolean;
  optional: boolean;
  games: Game[];
  note: string;
}
