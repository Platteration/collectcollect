// Money and timestamps read the same in either app, so they live in the shared
// package; picking a card's picture does not, so it stays here.
import { httpUrl } from "@collectcollect/core/format";

export { day, httpUrl, money, when } from "@collectcollect/core/format";

/**
 * Today as an <input type="date"> value, in the viewer's own zone. The UTC
 * date is tomorrow's for anyone in the Americas after about 7pm, which is when
 * most sales and purchases get written down.
 */
export function localDateInput(now = new Date(), offsetMinutes = now.getTimezoneOffset()): string {
  return new Date(now.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Where a card's picture is served from: its own photo (full, or the small copy for a grid), else the source's reference image. */
export function imageSrc(card: { imagePath: string | null; referenceImageUrl: string | null }, size: "full" | "thumb" = "full"): string | null {
  if (card.imagePath) return `/api/uploads/${card.imagePath}${size === "thumb" ? "?size=thumb" : ""}`;
  // Checked here as well as when it is saved: a restored database is not saved through the app.
  return httpUrl(card.referenceImageUrl);
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

/**
 * A caveat from a card's identification, without the punctuation and spaces
 * it ended with, so the page can close the sentence itself. Trimmed rather
 * than matched with `/[.;,]?\s*$/`, which tries every position in a run of
 * spaces: the caveat is stored text, from the vision model or a file read
 * back in, and the card page is drawn on the server.
 */
export function caveatSentence(caveat: string): string {
  const trimmed = caveat.trimEnd();
  return /[.;,]$/.test(trimmed) ? trimmed.slice(0, -1) : trimmed;
}
