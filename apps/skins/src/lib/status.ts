import { PROVIDERS } from "./pricing/index";
import type { ProviderStatus } from "./types";

/**
 * What this app can and cannot price with, said plainly.
 *
 * Every source is listed whether or not it is usable, and one that is not says
 * why. A price source quietly missing from the list would read as "there is no
 * such thing", which is a worse answer than "needs a key".
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
    ...PROVIDERS.map((provider) => ({
      id: provider.id,
      label: provider.label,
      configured: provider.isConfigured(),
      optional: provider.optional,
      note: provider.note,
    })),
  ];
}
