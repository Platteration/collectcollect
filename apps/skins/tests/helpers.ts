import { createItem } from "@/lib/items";
import type { ItemInput } from "@/lib/types";

/** A Field-Tested AK Redline: the archetypal unique item, with a float and a pattern. */
export function redline(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    marketHashName: "AK-47 | Redline (Field-Tested)",
    category: "weapon",
    weapon: "AK-47",
    finish: "Redline",
    rarity: "classified",
    collection: "The Huntsman Collection",
    floatValue: 0.22,
    paintSeed: 412,
    ...overrides,
  };
}

/** A Clutch Case: the archetypal stackable item, where lots do the real work. */
export function clutchCase(overrides: Partial<ItemInput> = {}): ItemInput {
  return { marketHashName: "Clutch Case", category: "case", ...overrides };
}

export function seedRedline(overrides: Partial<ItemInput> = {}) {
  return createItem(redline(overrides));
}

export function seedCase(overrides: Partial<ItemInput> = {}) {
  return createItem(clutchCase(overrides));
}
