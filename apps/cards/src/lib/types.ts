// Shared domain types for the card catalog.

/**
 * Ceilings on what a count or a price may be. Nobody holds a million copies of
 * one card and none sells for a billion dollars; a number past these is a typo
 * or a bad column mapping, and taking it would swamp every total on every page.
 */
export const MAX_QUANTITY = 1_000_000;
export const MAX_MONEY = 1_000_000_000;

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

/**
 * Whether a string names a game. `Object.hasOwn`, never `in`: "constructor"
 * and "toString" are on every object's prototype, and would otherwise pass as
 * games all the way to a price lookup.
 */
export function isGame(value: unknown): value is Game {
  return typeof value === "string" && Object.hasOwn(GAMES, value);
}

export const CONDITIONS: Record<Condition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export function isCondition(value: unknown): value is Condition {
  return typeof value === "string" && Object.hasOwn(CONDITIONS, value);
}

export const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "TAG", "ACE", "AGS", "Other"] as const;

/** The companies whose public report a cert number opens; "Other" has none. */
export const GRADING_AGENCIES = ["PSA", "BGS", "CGC", "SGC", "TAG", "ACE", "AGS"] as const;
export type GradingAgency = (typeof GRADING_AGENCIES)[number];

/**
 * A border ratio as a grader writes it, direction kept: [55, 45] is "55/45",
 * the left (or top) border first. Integers that add up to 100.
 */
export type Ratio = [number, number];
export interface CenteringSide {
  lr: Ratio | null;
  tb: Ratio | null;
}
/** How far a card's print sits from the middle, measured on each side. */
export interface Centering {
  front: CenteringSide;
  back: CenteringSide;
}
/** What a client may send for centering: each axis as "55/45" text, a pair, or nothing. */
export interface CenteringInput {
  front?: { lr?: Ratio | string | number | null; tb?: Ratio | string | number | null } | string | null;
  back?: { lr?: Ratio | string | number | null; tb?: Ratio | string | number | null } | string | null;
}

/** One of a grader's subgrades, for the front and the back when the grader scores both. */
export interface Subgrade {
  front: number | null;
  back: number | null;
}

/**
 * What a grading company's public report says about one slab, as PSA's API
 * answered it or as the owner typed it off the report. Only the blocks a
 * company publishes are filled: BGS and ACE score four subgrades, AGS eight,
 * TAG a 1000-point score with its own breakdown, PSA none.
 */
export interface GradingReport {
  company: GradingAgency;
  cert: string;
  source: "psa" | "manual";
  /** When the report was fetched or entered. */
  checkedAt: string;
  /** The label variant: "Pristine", "Black Label", "Standard"… */
  label: string | null;
  /** The grade as a number string, "10" or "9.5"; "AUTHENTIC" for an ungraded slab. */
  grade: string | null;
  /** The grade as the report prints it, e.g. "GEM MT 10". */
  gradeText: string | null;
  gradedAt: string | null;
  subgrades: { centering: Subgrade; corners: Subgrade; edges: Subgrade; surface: Subgrade } | null;
  tag: {
    /** TAG's score out of 1000, on its scored service. */
    score: number | null;
    rollups: { centering: number | null; corners: number | null; edges: number | null; surface: number | null };
    composite: { front: number | null; back: number | null };
    /** How many defects of note the report lists per side. */
    dings: { cornersFront: number | null; cornersBack: number | null; edgesFront: number | null; edgesBack: number | null; surfaceFront: number | null; surfaceBack: number | null };
  } | null;
  population: { atGrade: number | null; total: number | null; higher: number | null } | null;
  /** The agency's own scans, shown from its site; never stored here. */
  images: { front: string | null; back: string | null } | null;
  /** The public report this came from or links to. */
  url: string | null;
  /** What the agency says the card is, kept apart from the owner's own record. */
  identity: { subject: string | null; brand: string | null; year: string | null; cardNumber: string | null; variety: string | null; category: string | null } | null;
}

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
    /** The same centering as border ratios, "55/45", when the photo lets them be read; absent on older identifications. */
    centering_ratios?: { front_lr: string | null; front_tb: string | null; back_lr: string | null; back_tb: string | null } | null;
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
  /** Measured border ratios, typed in, read off a report, or read from the photo. */
  centering: Centering | null;
  /** The grading company's report on this slab, when one has been fetched or entered. */
  gradingReport: GradingReport | null;
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
/** What a client may send as a grading report: the four keys that name it, and any of the rest, numbers as text if it likes. */
export interface GradingReportInput {
  company: string;
  cert: string;
  source: string;
  checkedAt: string;
  label?: string | null;
  grade?: string | null;
  gradeText?: string | null;
  gradedAt?: string | null;
  subgrades?: Partial<Record<"centering" | "corners" | "edges" | "surface", Partial<Record<"front" | "back", number | string | null>> | null>> | null;
  tag?: {
    score?: number | string | null;
    rollups?: Partial<Record<"centering" | "corners" | "edges" | "surface", number | string | null>> | null;
    composite?: Partial<Record<"front" | "back", number | string | null>> | null;
    dings?: Partial<Record<"cornersFront" | "cornersBack" | "edgesFront" | "edgesBack" | "surfaceFront" | "surfaceBack", number | string | null>> | null;
  } | null;
  population?: Partial<Record<"atGrade" | "total" | "higher", number | string | null>> | null;
  images?: Partial<Record<"front" | "back", string | null>> | null;
  url?: string | null;
  identity?: Partial<Record<"subject" | "brand" | "year" | "cardNumber" | "variety" | "category", string | null>> | null;
}

export type CardInput = Partial<
  Omit<CardRecord, "id" | "createdAt" | "updatedAt" | "centering" | "gradingReport">
> & { game: Game; name: string; centering?: CenteringInput | Centering | null; gradingReport?: GradingReportInput | GradingReport | null };

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
  /** When the derived figures were last re-read from these quotes after an edit, if ever. */
  recomputedAt?: string;
  /** Every source behind each graded price, so an average can show what it averaged; absent when nothing graded was reported. */
  gradedSources?: Record<string, Array<{ source: string; price: number }>>;
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
  /**
   * When a later refresh last found exactly these prices. Such a refresh adds
   * no snapshot; it marks this one, so the row is the price and this is how
   * recently it was confirmed.
   */
  checkedAt?: string;
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
    "TAG 10": 3.0,
    "TAG 9": 1.3,
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
  id: PriceSource | "claude" | "psa";
  label: string;
  configured: boolean;
  optional: boolean;
  games: Game[];
  note: string;
  /** Whether Settings offers a connection test; a source whose every call is spent against a daily budget has none. */
  testable: boolean;
}
