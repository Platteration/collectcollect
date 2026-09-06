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
  const settings = saveSettings({
    gradeMultipliers: body.gradeMultipliers ?? current.gradeMultipliers,
    conditionMultipliers: body.conditionMultipliers ?? current.conditionMultipliers,
    gradingFee: body.gradingFee ?? current.gradingFee,
  });
  return NextResponse.json({ settings, providers: providerStatuses() });
}
