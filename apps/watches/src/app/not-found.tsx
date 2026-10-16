import { NotFound } from "@collectcollect/core/components/NotFound";

/**
 * An address with nothing at it, or an item that was removed. The framework's
 * own page for this draws itself with an inline <style>, which the policy
 * refuses, so it showed unstyled (white, in a dark theme) with a violation.
 */
export default function ItemNotFound() {
  return <NotFound thing="items" homeHref="/collection" homeLabel="Open the collection" />;
}
