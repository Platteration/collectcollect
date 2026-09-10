// Shared domain types for the CS2 inventory.

/**
 * What kind of thing this is.
 *
 * The split that matters is not cosmetic: a weapon, knife or glove carries a
 * float and a pattern seed, which together make it a unique object. Everything
 * else is fungible — one Clutch Case is any other Clutch Case — so it stacks.
 */
export type Category =
  | "weapon"
  | "knife"
  | "glove"
  | "sticker"
  | "case"
  | "capsule"
  | "agent"
  | "graffiti"
  | "patch"
  | "charm"
  | "music_kit"
  | "pin"
  | "pass"
  | "key"
  | "other";

export const CATEGORIES: Record<Category, string> = {
  weapon: "Weapon",
  knife: "Knife",
  glove: "Gloves",
  sticker: "Sticker",
  case: "Case",
  capsule: "Capsule",
  agent: "Agent",
  graffiti: "Graffiti",
  patch: "Patch",
  charm: "Charm",
  music_kit: "Music kit",
  pin: "Pin",
  pass: "Pass",
  key: "Key",
  other: "Other",
};

export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];

/** The categories whose items are unique objects, so they never merge. */
const UNIQUE_CATEGORIES: ReadonlySet<Category> = new Set<Category>(["weapon", "knife", "glove"]);

/**
 * Whether two of these are interchangeable.
 *
 * Stacking is a property of the category rather than of the row, so it is
 * derived here and stored alongside the item only so SQL can filter on it.
 */
export function isStackable(category: Category): boolean {
  return !UNIQUE_CATEGORIES.has(category);
}

/** Whether items in this category have a wear value at all. */
export function hasWear(category: Category): boolean {
  return UNIQUE_CATEGORIES.has(category);
}

/**
 * The five wear tiers, in the order Valve prints them. This is the same shape
 * as a card's condition scale — five bands modifying one base price — which is
 * why the settings multipliers work the same way.
 */
export type Exterior = "factory_new" | "minimal_wear" | "field_tested" | "well_worn" | "battle_scarred";

export const EXTERIORS: Record<Exterior, string> = {
  factory_new: "Factory New",
  minimal_wear: "Minimal Wear",
  field_tested: "Field-Tested",
  well_worn: "Well-Worn",
  battle_scarred: "Battle-Scarred",
};

export const EXTERIOR_IDS = Object.keys(EXTERIORS) as Exterior[];

/**
 * Where each tier starts and ends on the 0..1 float scale. The upper bound is
 * exclusive except at the top, so 0.07 is Minimal Wear and 1.0 is
 * Battle-Scarred.
 */
export const EXTERIOR_RANGES: Record<Exterior, { min: number; max: number }> = {
  factory_new: { min: 0, max: 0.07 },
  minimal_wear: { min: 0.07, max: 0.15 },
  field_tested: { min: 0.15, max: 0.38 },
  well_worn: { min: 0.38, max: 0.45 },
  battle_scarred: { min: 0.45, max: 1 },
};

/** The tier a float falls in, or null if it is not a float at all. */
export function exteriorForFloat(value: number | null | undefined): Exterior | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  for (const id of EXTERIOR_IDS) {
    const range = EXTERIOR_RANGES[id];
    if (value < range.max) return id;
  }
  return "battle_scarred";
}

/**
 * How far through its own tier a float sits, 0 at the clean end and 1 at the
 * worn end. Two Field-Tested copies can be most of a tier apart, and this is
 * the number that says so.
 */
export function wearWithinTier(value: number): number | null {
  const tier = exteriorForFloat(value);
  if (!tier) return null;
  const { min, max } = EXTERIOR_RANGES[tier];
  return (value - min) / (max - min);
}

/**
 * The rarity ladder, which in CS2 is a colour before it is a word. Categories
 * print different names on the same colours — a Covert weapon and an
 * Extraordinary sticker are both red — so the ladder is stored once and each
 * category's own wording is a label on top of it.
 */
export type Rarity =
  | "consumer"
  | "industrial"
  | "mil_spec"
  | "restricted"
  | "classified"
  | "covert"
  | "extraordinary"
  | "contraband";

export const RARITIES: Record<Rarity, { label: string; color: string }> = {
  consumer: { label: "Consumer Grade", color: "#b0c3d9" },
  industrial: { label: "Industrial Grade", color: "#5e98d9" },
  mil_spec: { label: "Mil-Spec", color: "#4b69ff" },
  restricted: { label: "Restricted", color: "#8847ff" },
  classified: { label: "Classified", color: "#d32ce6" },
  covert: { label: "Covert", color: "#eb4b4b" },
  extraordinary: { label: "Extraordinary", color: "#ffd700" },
  contraband: { label: "Contraband", color: "#e4ae39" },
};

export const RARITY_IDS = Object.keys(RARITIES) as Rarity[];

/** Ordered cheapest tier first, for sorting and for allocation charts. */
export const RARITY_ORDER: Record<Rarity, number> = {
  consumer: 0,
  industrial: 1,
  mil_spec: 2,
  restricted: 3,
  classified: 4,
  covert: 5,
  extraordinary: 6,
  contraband: 7,
};

/** A sticker as applied to a weapon, in its slot. */
export interface AppliedSticker {
  slot: number;
  name: string;
  marketHashName: string | null;
  /** How far the sticker has been scratched, 0 unscraped through 1 gone. */
  wear: number | null;
}

export interface ItemRecord {
  id: number;
  /** Steam's own name for the thing, which is the key every market agrees on. */
  marketHashName: string;
  category: Category;
  stackable: boolean;
  /** "AK-47" and "Redline"; either may be absent for a case or an agent. */
  weapon: string | null;
  finish: string | null;
  exterior: Exterior | null;
  rarity: Rarity | null;
  collection: string | null;
  stattrak: boolean;
  souvenir: boolean;
  /** 0..1 wear, the finer truth beneath the exterior tier. */
  floatValue: number | null;
  paintSeed: number | null;
  paintIndex: number | null;
  nameTag: string | null;
  quantity: number;
  /** Average of what the copies still held cost; derived from the lots. */
  purchasePrice: number | null;
  /** Steam's identifier for this exact object, when it came from an inventory. */
  assetId: string | null;
  inspectLink: string | null;
  /** When a trade lock lifts. A locked item cannot be sold, wherever it is worth most. */
  tradableAfter: string | null;
  /** The storage unit or account it is kept in — the card app's "location". */
  storageUnit: string | null;
  imageUrl: string | null;
  notes: string | null;
  externalIds: Record<string, string>;
  /** A price typed in by hand, which overrides every source. */
  manualPrice: number | null;
  stickers: AppliedSticker[];
  createdAt: string;
  updatedAt: string;
}

/** Fields a client may send when creating or updating an item. */
export type ItemInput = Partial<Omit<ItemRecord, "id" | "stackable" | "createdAt" | "updatedAt">> & {
  marketHashName: string;
};

export type PriceSource = "steam" | "skinport" | "csfloat" | "manual";

/** Where an item could actually be sold, and what each market keeps. */
export interface Market {
  id: Exclude<PriceSource, "manual">;
  label: string;
  /** Whether what you are paid can leave the platform as money. */
  cashOut: boolean;
  note: string;
}

export const MARKETS: Record<Market["id"], Market> = {
  steam: {
    id: "steam",
    label: "Steam Community Market",
    cashOut: false,
    note: "Proceeds are Steam wallet funds and cannot be withdrawn.",
  },
  skinport: { id: "skinport", label: "Skinport", cashOut: true, note: "Pays out to a bank account or card." },
  csfloat: { id: "csfloat", label: "CSFloat", cashOut: true, note: "Pays out to a bank account." },
};

export const MARKET_IDS = Object.keys(MARKETS) as Market["id"][];

export type Currency = "USD" | "EUR";

/** One market's answer for one item. */
export interface PriceQuote {
  source: PriceSource;
  sourceLabel: string;
  currency: Currency;
  url: string | null;
  matchedName: string;
  /** The going rate a buyer pays, before the market takes its cut. */
  price: number | null;
  /** Copies sold in the last day, where the source reports it. */
  volume: number | null;
  fetchedAt: string;
}

/** Consolidated view the UI shows; stored as a snapshot per refresh. */
export interface PriceSummary {
  currency: "USD";
  fetchedAt: string;
  /** The headline market price, and which source it came from. */
  market: number | null;
  marketSource: string | null;
  /** What this copy is worth, allowing for its wear and its StatTrak premium. */
  yourCopyValue: number | null;
  yourCopyBasis: string;
  quotes: PriceQuote[];
  errors: Array<{ source: string; message: string }>;
}

export interface PriceSnapshot {
  id: number;
  itemId: number;
  fetchedAt: string;
  summary: PriceSummary;
}

export interface Sale {
  id: number;
  itemId: number;
  quantity: number;
  /** What each copy sold for, before the market's cut. */
  unitPrice: number;
  /** The market's cut and any other cost, for the whole sale. */
  fees: number;
  /** Cost basis per copy, captured at sale time so later edits don't rewrite history. */
  unitCost: number | null;
  soldAt: string;
  venue: string | null;
  notes: string | null;
  createdAt: string;
}

/** A sale joined to the item it came from, for lists that span items. */
export interface SaleWithItem extends Sale {
  itemName: string;
  itemDetail: string;
  category: Category;
}

export type AlertKind = "spread_opened" | "price_move" | "trade_lock_lifted";

export interface Alert {
  id: number;
  kind: AlertKind;
  itemId: number | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface Settings {
  /** Multiplier applied to the tier's price for a copy at this wear. */
  exteriorMultipliers: Record<Exterior, number>;
  /**
   * Stand-in premiums for when only the plain variant of a skin has a quote.
   * Every market prices StatTrak and Souvenir copies under their own names, so
   * these apply to an estimate, never to a quote that was already for the right
   * variant.
   */
  stattrakMultiplier: number;
  souvenirMultiplier: number;
  /** What each market keeps, as a fraction of the buyer's price. */
  marketFees: Record<Market["id"], number>;
  /** Shown on the printable valuation report. */
  ownerName: string;
  /** Raise a price-move alert when an item's value changes by at least this much between refreshes. */
  alertMovePercent: number;
  /** A spread counts as worth acting on when it clears both of these. */
  spreadMinAmount: number;
  spreadMinPercent: number;
  /** Optional URL that new alerts are POSTed to, for wiring up email or push. */
  alertWebhookUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  // A tier's own market price already reflects its wear, so these start at 1:
  // they exist to price a copy against a neighbouring tier's quote, not to
  // discount a quote that was already for the right tier.
  exteriorMultipliers: {
    factory_new: 1.0,
    minimal_wear: 1.0,
    field_tested: 1.0,
    well_worn: 1.0,
    battle_scarred: 1.0,
  },
  // Left at 1 rather than at a plausible-looking guess: an invented premium
  // would read as a measurement. Set it once you know your own market.
  stattrakMultiplier: 1.0,
  souvenirMultiplier: 1.0,
  marketFees: {
    // Steam's 15% is charged to the buyer, so a seller nets price / 1.15.
    // Stored as the fraction of the listing price the seller loses, which is
    // what makes it comparable with the others.
    steam: 0.1304,
    skinport: 0.12,
    csfloat: 0.02,
  },
  ownerName: "",
  alertMovePercent: 15,
  spreadMinAmount: 1,
  spreadMinPercent: 5,
  alertWebhookUrl: "",
};

export interface ProviderStatus {
  id: PriceSource;
  label: string;
  configured: boolean;
  optional: boolean;
  note: string;
}
