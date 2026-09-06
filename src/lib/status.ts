import { isClaudeConfigured, claudeModel } from "./identify/claude";
import { PROVIDERS } from "./pricing";
import type { ProviderStatus } from "./types";

export function providerStatuses(): ProviderStatus[] {
  return [
    {
      id: "claude",
      label: `Claude vision (${claudeModel()})`,
      configured: isClaudeConfigured(),
      optional: false,
      games: ["pokemon", "yugioh", "mtg", "sports", "other"],
      note: "Identifies cards from photos. Set ANTHROPIC_API_KEY. Without it you can still add cards by hand.",
    },
    ...PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.isConfigured(),
      optional: p.optional,
      games: p.games,
      note: p.note,
    })),
  ];
}
