import type { ProviderStatus } from "./types";

/**
 * What this app can and cannot price with, said plainly.
 *
 * Every source is listed whether or not it is usable, and one that is not says
 * why. A price source quietly missing from the list would read as "there is no
 * such thing", which is a worse answer than "not wired up yet".
 */
export function providerStatuses(): ProviderStatus[] {
  return [
    {
      id: "manual",
      label: "Your own price",
      configured: true,
      optional: false,
      note: "A price you type in overrides every source, on that item.",
    },
    {
      id: "steam",
      label: "Steam Community Market",
      configured: false,
      optional: true,
      note: "Not wired up yet. Needs no key, but is rate limited to roughly twenty requests a minute.",
    },
    {
      id: "skinport",
      label: "Skinport",
      configured: false,
      optional: true,
      note: "Not wired up yet. Returns the whole catalogue in one call, which suits a large inventory.",
    },
    {
      id: "csfloat",
      label: "CSFloat",
      configured: false,
      optional: true,
      note: "Not wired up yet. Also the only source for the float of an item you have not inspected.",
    },
  ];
}
