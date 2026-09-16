import path from "node:path";
import type { Page } from "@playwright/test";
import { openDatabase, setDb } from "../src/lib/db";
import { DB_FILE } from "../src/lib/paths";
import { claimScanIdentification, finishScanIdentification } from "../src/lib/scan-drafts";
import type { Identification } from "../src/lib/types";
import { OPEN_DATA_DIR } from "./data-dir";
import type { StubCard } from "./helpers";

/** Replace only the paid identification boundary; persist its answer through the real repository. */
export async function stubScans(page: Page, cards: StubCard[], waitFirst = false) {
  let index = 0, waited = false;
  await page.route("**/api/scan-drafts/*/identify", async (route) => {
    if (waitFirst && !waited) {
      waited = true;
      await route.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: { error: "Identifier busy" } });
      return;
    }
    const card = cards[Math.min(index++, cards.length - 1)];
    if (!card) throw new Error("A scan fixture needs a card");
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const body = route.request().postDataJSON() as { revision: number };
    const identification: Identification = {
      game: (card.game ?? "pokemon") as Identification["game"], name: card.name, sport: null,
      set_name: card.set_name ?? "Base Set", set_code: null, card_number: card.card_number ?? null,
      year: 1999, rarity: null, variant: null, language: "English", manufacturer: null, subject: null,
      grading: { company: null, grade: null, cert_number: null }, condition_notes: null,
      confidence: card.confidence ?? 0.95, alternatives: [], search_query: card.name,
    };
    const db = openDatabase(path.join(OPEN_DATA_DIR, DB_FILE));
    try {
      setDb(db);
      const claim = claimScanIdentification(id, body.revision);
      const draft = finishScanIdentification(id, claim.token, identification);
      await route.fulfill({ status: 200, json: { draft } });
    } finally { setDb(undefined); db.close(); }
  });
}
