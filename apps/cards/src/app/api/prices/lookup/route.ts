import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
import { fetchQuotes, summarize } from "@/lib/pricing";
import type { CardQuery } from "@/lib/pricing/types";
import { getSettings } from "@/lib/settings";
import { isCondition, isGame } from "@/lib/types";

/**
 * POST — price a card that is not saved yet (used while reviewing an
 * identification). Body: CardQuery plus optional condition / grading fields.
 */
export async function POST(request: Request) {
  let body: Partial<CardQuery> & { condition?: string; gradingCompany?: string | null; grade?: string | null };
  // A card's identity is well under 16 KB; a runaway client cannot buffer more.
  try {
    body = (await readJsonLimited(request, 16 * 1024)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON body");
  }
  if (!isGame(body.game)) return jsonError("Unknown game");
  if (!body.name?.trim()) return jsonError("Card name is required");
  const query: CardQuery = {
    game: body.game,
    name: body.name.trim(),
    sport: body.sport ?? null,
    setName: body.setName ?? null,
    setCode: body.setCode ?? null,
    cardNumber: body.cardNumber ?? null,
    year: body.year ?? null,
    variant: body.variant ?? null,
    manufacturer: body.manufacturer ?? null,
    externalIds: body.externalIds ?? {},
  };
  if (body.condition !== undefined && body.condition !== null && body.condition !== "" && !isCondition(body.condition)) {
    return jsonError("Unknown condition");
  }
  const condition = isCondition(body.condition) ? body.condition : "NM";
  const { quotes, errors } = await fetchQuotes(query);
  const summary = summarize(quotes, errors, getSettings(), {
    condition,
    gradingCompany: body.gradingCompany ?? null,
    grade: body.grade ?? null,
  });
  return NextResponse.json({ summary });
}
