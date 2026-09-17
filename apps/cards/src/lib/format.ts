// Money and timestamps read the same in either app, so they live in the shared
// package; picking a card's picture does not, so it stays here.
export { day, money, when } from "@collectcollect/core/format";

export function imageSrc(card: { imagePath: string | null; referenceImageUrl: string | null }): string | null {
  if (card.imagePath) return `/api/uploads/${card.imagePath}`;
  return card.referenceImageUrl;
}

/**
 * One line naming what lost a photo — "Charizard (card 12): a1b2….jpg; scan
 * draft 9f…: c3d4….jpg" — for the log, the manifest and the Settings page.
 */
export function describeMissingPhotos(missing: Array<{ photo: string; cardId: number | null; cardName: string | null; draftId: string | null }>): string {
  return missing
    .map((item) => (item.cardId !== null ? `${item.cardName} (card ${item.cardId}): ${item.photo}` : `scan draft ${item.draftId}: ${item.photo}`))
    .join("; ");
}
