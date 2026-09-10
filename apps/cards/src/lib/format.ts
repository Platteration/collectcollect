// Money and timestamps read the same in either app, so they live in the shared
// package; picking a card's picture does not, so it stays here.
export { money, when } from "@collectcollect/core/format";

export function imageSrc(card: { imagePath: string | null; referenceImageUrl: string | null }): string | null {
  if (card.imagePath) return `/api/uploads/${card.imagePath}`;
  return card.referenceImageUrl;
}
