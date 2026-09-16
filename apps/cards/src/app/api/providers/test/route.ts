import { createThrottle } from "@collectcollect/core/throttle";
import { jsonError } from "@/lib/http";
import { checkProvider } from "@/lib/provider-check";
export const throttle = createThrottle(6, 60_000, "connection tests");
export async function POST(request: Request) {
  const refused = throttle.check(request); if (refused) return refused;
  try {
    const body = await request.json();
    if (!body || !["claude", "pokemontcg", "pricecharting", "scryfall", "ygoprodeck"].includes(body.id)) return jsonError("Unknown provider");
    return Response.json(await checkProvider(body.id));
  } catch { return jsonError("Expected a JSON object"); }
}
