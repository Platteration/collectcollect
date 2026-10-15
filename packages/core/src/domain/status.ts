import type { PriceProvider, ProviderStatus } from "./spec";
import { claudeModel, isClaudeConfigured } from "./identify";
import { providerStatuses } from "./pricing/index";

/** What this app can and cannot price and identify with, said plainly. */
export function domainStatuses<Q>(providers: PriceProvider<Q>[], hasIdentify: boolean, noun: string): ProviderStatus[] {
  const out: ProviderStatus[] = [];
  if (hasIdentify) {
    out.push({
      id: "claude",
      label: `Claude vision (${claudeModel()})`,
      configured: isClaudeConfigured(),
      optional: true,
      note: `Identifies a ${noun} from photos. Set ANTHROPIC_API_KEY. Without it you can still add by hand.`,
    });
  }
  return [...out, ...providerStatuses(providers)];
}
