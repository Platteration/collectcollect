import { createThrottle } from "@collectcollect/core/throttle";
import { jsonError } from "@/lib/http";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
import { checkProvider } from "@/lib/provider-check";
export const throttle = createThrottle(6, 60_000, "connection tests");
export async function POST(request: Request) {
  const refused = throttle.check(request); if (refused) return refused;
  try {
    // A provider's name; a runaway client cannot buffer more than a few kilobytes here.
    const body = await readJsonLimited<{ id?: unknown } | null>(request, 4 * 1024);
    const id = body?.id;
    if (typeof id !== "string" || !["claude", "pokemontcg", "pricecharting", "scryfall", "ygoprodeck"].includes(id)) return jsonError("Unknown provider");
    return Response.json(await checkProvider(id));
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON object");
  }
}
