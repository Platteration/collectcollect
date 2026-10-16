import { NotFound } from "@collectcollect/core/components/NotFound";

/**
 * An address with nothing at it, or an item that was removed. The framework's
 * own page for this draws itself with an inline <style>, which the policy
 * refuses: it reported a violation on every 404, showed a bare "404 This page
 * could not be found." and offered no way out but the tab bar.
 */
export default function ItemNotFound() {
  return <NotFound thing="items" homeHref="/collection" homeLabel="Open the collection" />;
}
