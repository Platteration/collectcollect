import type { PriceSource } from "../types";

/**
 * Which source a figure is credited to, and wins an ungraded price, when
 * several report it: earlier first. Its own file, with nothing to import but a
 * type, because the analytics that credit a bound to a source run in the
 * browser too, and the provider list they would otherwise pull in does not.
 */
export const SOURCE_PRIORITY: readonly PriceSource[] = ["manual", "pricecharting", "pokemontcg", "scryfall", "ygoprodeck", "ebay"];
