/**
 * Where an item's picture may come from: Steam's two image hosts, and nowhere
 * else. The proxy's `img-src` is this list (src/proxy.ts), and every page that
 * draws an item's picture asks `shownImage` first.
 *
 * An item's image address is whatever brought the item in: Steam's inventory
 * names its own host, but a spreadsheet's image column or a hand-edited file
 * can name any. The policy refuses every host not listed, so drawing such an
 * address gave a broken picture and a policy violation on every page that
 * listed the item. It is kept on the item, and in its file and exports, as it
 * was given; the page shows "No image" instead of asking for it.
 */
export const IMAGE_SOURCES = ["https://community.cloudflare.steamstatic.com", "https://steamcommunity-a.akamaihd.net"];

/** The address to draw for an item's image, or null when the policy would refuse it. */
export function shownImage(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Chromium refuses a picture whose address carries a user name or password.
  if (parsed.username || parsed.password) return null;
  // A source such as https://host matches that scheme, host and default port only.
  return IMAGE_SOURCES.includes(parsed.origin) ? parsed.href : null;
}
