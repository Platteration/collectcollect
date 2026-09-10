import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
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
  // that is what JSON does with NaN. Saving around it would drop the field
  // back to a default and still answer "saved", so say what is wrong instead.
  const problems: string[] = [];
  const number = (label: string, value: unknown, fallback: number): number => {
    if (value === undefined) return fallback;
    const n = typeof value === "number" ? value : Number(value);
    if (value === null || !Number.isFinite(n) || n < 0) {
      problems.push(label);
      return fallback;
    }
    return n;
  };
  const numbers = (label: string, value: unknown, fallback: Record<string, number>): Record<string, number> => {
    if (value === undefined) return fallback;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      problems.push(label);
      return fallback;
    }
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (key === "__proto__") continue;
      out[key] = number(`${label} (${key})`, raw, Number.NaN);
    }
    return out;
  };

  const gradeMultipliers = numbers("grade multipliers", body.gradeMultipliers, current.gradeMultipliers);
  const conditionMultipliers = numbers("condition multipliers", body.conditionMultipliers, current.conditionMultipliers);
  const gradingFee = number("grading fee", body.gradingFee, current.gradingFee);
  const readyMinUpside = number("ready-to-grade amount", body.readyMinUpside, current.readyMinUpside);
  const readyMinUpsidePercent = number("ready-to-grade percentage", body.readyMinUpsidePercent, current.readyMinUpsidePercent);
  const alertMovePercent = number("price-move alert percentage", body.alertMovePercent, current.alertMovePercent);

  if (problems.length) {
    return jsonError(`These have to be numbers, and none of your settings were changed: ${problems.join(", ")}.`);
  }

  const settings = saveSettings({
    gradeMultipliers,
    // A partial set of conditions leaves the rest as they are, rather than
    // taking the ones it did not mention back to the app's defaults.
    conditionMultipliers: { ...current.conditionMultipliers, ...conditionMultipliers } as Settings["conditionMultipliers"],
    gradingFee,
    readyMinUpside,
    readyMinUpsidePercent,
    ownerName: body.ownerName ?? current.ownerName,
    alertMovePercent,
    alertWebhookUrl: body.alertWebhookUrl ?? current.alertWebhookUrl,
  });
  return NextResponse.json({ settings, providers: providerStatuses() });
}
