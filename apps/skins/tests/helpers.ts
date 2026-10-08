import { createItem } from "@/lib/items";
import type { ItemInput } from "@/lib/types";
import { clutchCase, redline } from "./fixtures";

export { clutchCase, redline };

export function seedRedline(overrides: Partial<ItemInput> = {}) {
  return createItem(redline(overrides));
}

export function seedCase(overrides: Partial<ItemInput> = {}) {
  return createItem(clutchCase(overrides));
}
