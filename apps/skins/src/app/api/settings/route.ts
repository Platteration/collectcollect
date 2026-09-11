import { NextResponse } from "next/server";
import { isWebhookUrl, jsonError } from "@collectcollect/core/http";
import { getSettings, saveSettings } from "@/lib/settings";
import { providerStatuses } from "@/lib/status";
import type { Settings } from "@/lib/types";

export async function GET() {
  return NextResponse.json({ settings: getSettings(), providers: providerStatuses() });
}

export async function PUT(request: Request) {
  let body: Partial<Settings>;
  try {
    body = (await request.json()) as Partial<Settings>;
  } catch {
    return jsonError("Expected a JSON body");
  }
  const current = getSettings();

  // Anything the browser could not turn into a number arrives as null, since
  // that is what JSON does with NaN. Saving around it would drop the field back
  // to a default and still answer "saved", so say what is wrong instead. The
  // same goes for a webhook that is not a URL: saving it as blank would switch
  // alerts off while reporting success.
  const problems: string[] = [];
  const number = (label: string, value: unknown, fallback: number, below = Infinity): number => {
    if (value === undefined) return fallback;
    const n = typeof value === "number" ? value : Number(value);
    if (value === null || !Number.isFinite(n) || n < 0 || n >= below) {
      problems.push(label);
      return fallback;
    }
    return n;
  };
  const numbers = (label: string, value: unknown, fallback: Record<string, number>, below = Infinity): Record<string, number> => {
    if (value === undefined) return fallback;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      problems.push(label);
      return fallback;
    }
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (key === "__proto__") continue;
      out[key] = number(`${label} (${key})`, raw, Number.NaN, below);
    }
    return out;
  };
  const text = (label: string, value: unknown, fallback: string): string => {
    if (value === undefined) return fallback;
    if (typeof value !== "string") {
      problems.push(label);
      return fallback;
    }
    return value;
  };

  const exteriorMultipliers = numbers("wear multipliers", body.exteriorMultipliers, current.exteriorMultipliers);
  // A fee is a fraction of the price, so 1 or more would mean a sale that pays
  // nothing or costs money. That is a typo, not a market.
  const marketFees = numbers("market fees", body.marketFees, current.marketFees, 1);
  const stattrakMultiplier = number("StatTrak premium", body.stattrakMultiplier, current.stattrakMultiplier);
  const souvenirMultiplier = number("Souvenir premium", body.souvenirMultiplier, current.souvenirMultiplier);
  const alertMovePercent = number("price-move alert percentage", body.alertMovePercent, current.alertMovePercent);
  const spreadMinAmount = number("spread amount", body.spreadMinAmount, current.spreadMinAmount);
  const spreadMinPercent = number("spread percentage", body.spreadMinPercent, current.spreadMinPercent);
  const ownerName = text("owner name", body.ownerName, current.ownerName);
  const alertWebhookUrl = text("webhook URL", body.alertWebhookUrl, current.alertWebhookUrl).trim();
  if (alertWebhookUrl && !isWebhookUrl(alertWebhookUrl)) problems.push("webhook URL (it has to start with http:// or https://)");

  if (problems.length) {
    return jsonError(`These are not right, and none of your settings were changed: ${problems.join(", ")}.`);
  }

  const settings = saveSettings({
    // A partial set leaves the rest as they are, rather than taking the ones it
    // did not mention back to the app's defaults.
    exteriorMultipliers: { ...current.exteriorMultipliers, ...exteriorMultipliers } as Settings["exteriorMultipliers"],
    marketFees: { ...current.marketFees, ...marketFees } as Settings["marketFees"],
    stattrakMultiplier,
    souvenirMultiplier,
    ownerName,
    alertMovePercent,
    spreadMinAmount,
    spreadMinPercent,
    alertWebhookUrl,
  });
  return NextResponse.json({ settings, providers: providerStatuses() });
}
