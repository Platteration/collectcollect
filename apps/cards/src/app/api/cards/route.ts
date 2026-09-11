import { NextResponse } from "next/server";
import { createCard, findSimilar, latestSnapshotsByCard, listCards } from "@/lib/cards";
import { errorMessage, jsonError } from "@/lib/http";
import type { CardInput } from "@/lib/types";
import { isGame } from "@/lib/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const game = url.searchParams.get("game");
  if (url.searchParams.get("similar") === "1") {
    if (!isGame(game)) return jsonError("Unknown game");
    const name = url.searchParams.get("name") ?? "";
    if (!name.trim()) return NextResponse.json({ cards: [] });
    return NextResponse.json({
      cards: findSimilar({ game, name, cardNumber: url.searchParams.get("number"), setName: url.searchParams.get("set") }),
    });
  }
  // A filter that names no game is refused rather than ignored: a list of
  // every card, answered to a request for one game's, is a wrong number.
  if (game !== null && game !== "" && !isGame(game)) return jsonError("Unknown game");
  const search = url.searchParams.get("q") ?? undefined;
  const cards = listCards({ game: isGame(game) ? game : undefined, search });
  const prices = latestSnapshotsByCard();
  return NextResponse.json({
    cards: cards.map((c) => ({ ...c, latestPrice: prices.get(c.id)?.summary ?? null })),
  });
}

export async function POST(request: Request) {
  let body: CardInput;
  try {
    body = (await request.json()) as CardInput;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    const card = createCard(body);
    return NextResponse.json({ card }, { status: 201 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
