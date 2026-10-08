import { randomBytes } from "node:crypto";
import type { ItemInput } from "../types";

interface Preview { steamId: string; items: ItemInput[]; unmatched: number; expiresAt: number }
const state = globalThis as unknown as { __steamReviewedPreviews?: Map<string, Preview> };
const previews = state.__steamReviewedPreviews ??= new Map<string, Preview>();
export const PREVIEW_TTL_MS = 10 * 60_000;
/** Bounded, server-held snapshots. An apply can only use the inventory that was reviewed. */
export function rememberPreview(steamId: string, items: ItemInput[], unmatched: number, now = Date.now()): { token: string; expiresAt: string } {
  for (const [token, preview] of previews) if (preview.expiresAt <= now) previews.delete(token);
  while (previews.size >= 5) previews.delete(previews.keys().next().value!);
  if (items.length > 20_000) throw new Error("This inventory is too large to preview in one import");
  const token = randomBytes(32).toString("hex"), expiresAt = now + PREVIEW_TTL_MS;
  previews.set(token, { steamId, items: structuredClone(items), unmatched, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}
export function consumePreview(token: string, steamId: string, now = Date.now()): Preview | null {
  const preview = previews.get(token);
  if (!preview || preview.steamId !== steamId) return null;
  previews.delete(token);
  return preview.expiresAt > now ? preview : null;
}
