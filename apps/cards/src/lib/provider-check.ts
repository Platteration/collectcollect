import Anthropic from "@anthropic-ai/sdk";
import { claudeModel, isClaudeConfigured } from "./identify/claude";
import { PROVIDERS } from "./pricing";
import type { CardQuery } from "./pricing/types";
const sample: Record<string, CardQuery> = {
  pokemontcg: { game: "pokemon", name: "Charizard", setName: "Base", cardNumber: "4" },
  pricecharting: { game: "pokemon", name: "Charizard", setName: "Base", cardNumber: "4" },
  scryfall: { game: "mtg", name: "Black Lotus", setCode: "lea" },
  ygoprodeck: { game: "yugioh", name: "Dark Magician" },
};
/** Small explicit probes only; never return credentials or a provider's raw error body. */
export async function checkProvider(id: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  try {
    if (id === "claude") {
      if (!isClaudeConfigured()) return { ok: false, message: "Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, then restart the app." };
      await new Anthropic({ fetch: fetchImpl, maxRetries: 0, timeout: 10_000 }).models.retrieve(claudeModel());
      return { ok: true, message: "Credentials accepted and the configured model is available. No photo was sent." };
    }
    const provider = PROVIDERS.find((p) => p.id === id);
    if (!provider) return { ok: false, message: "Unknown provider." };
    if (!provider.isConfigured()) return { ok: false, message: "Add this provider's key to the environment and restart the app." };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const quotes = await provider.lookup(sample[id]!, (url, options) => fetchImpl(url, { ...options, signal: controller.signal }));
      return { ok: true, message: quotes.length ? "Connection succeeded and a sample price was returned." : "Connection succeeded. No price matched the sample card." };
    } finally { clearTimeout(timer); }
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) return { ok: false, message: "Credentials were refused. Check the key and its permissions, then restart the app." };
    if (status === 404) return { ok: false, message: "The configured model or provider endpoint was not found. Check the model setting." };
    if (status === 429) return { ok: false, message: "The provider is rate limited. Wait before testing again." };
    return { ok: false, message: "The provider could not complete the test. Check connectivity, credentials and provider status; try again later." };
  }
}
