import { isClaudeConfigured, claudeModel } from "./identify/claude";
import { isPsaConfigured } from "./grading/psa";
import { PROVIDERS } from "./pricing";
import type { ProviderStatus } from "./types";

export function providerStatuses(): ProviderStatus[] {
  return [
    {
      id: "claude",
      label: `Claude vision (${claudeModel()})`,
      configured: isClaudeConfigured(),
      optional: true,
      games: ["pokemon", "yugioh", "mtg", "sports", "other"],
      note: "Identifies cards from photos. Set ANTHROPIC_API_KEY. Without it you can still add cards by hand.",
      testable: true,
    },
    ...PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.isConfigured(),
      optional: p.optional,
      games: p.games,
      note: p.note,
      testable: true,
    })),
    {
      id: "psa",
      label: "PSA cert lookup",
      configured: isPsaConfigured(),
      optional: true,
      games: ["pokemon", "yugioh", "mtg", "sports", "other"],
      note: "Set PSA_API_TOKEN to fill a graded card's grade, label, population and PSA's own scans from its cert number. PSA issues the token from your PSA account and approves accounts for its API, so a new token may be refused until then; the card page says so, and the report can always be entered by hand. Generating the token accepts PSA's API agreement; this app stores only what it shows.",
      // A probe would spend one of the day's lookups; the first lookup is the test.
      testable: false,
    },
  ];
}
