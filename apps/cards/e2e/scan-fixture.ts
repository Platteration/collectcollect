import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect, test as base, type Page } from "@playwright/test";
import { setDb } from "../src/lib/db";
import { DB_FILE } from "../src/lib/paths";
import { claimScanIdentification, finishScanIdentification, getScanDraft } from "../src/lib/scan-drafts";
import type { Identification } from "../src/lib/types";
import type { ScanDraft } from "../src/lib/scan-types";
import { OPEN_DATA_DIR } from "./data-dir";
import { cardPhoto, type StubCard } from "./helpers";

/** Mock only paid identification; uploads and commits still reach the real server. */
async function stubScans(page: Page, cards: StubCard[], waitFirst = false) {
  const suffix = randomUUID().slice(0, 8);
  const outcomes = cards.map((card) => ({ ...card, name: `${card.name} ${suffix}` }));
  const photos = await Promise.all(outcomes.map(async (_, index) => ({
    ...await cardPhoto(page, [40 + index * 40, 90, 150]), name: `scan-${suffix}-${index}.jpg`,
  })));
  const byFilename = new Map(photos.map((photo, index) => [photo.name, outcomes[index]]));
  const byDraft = new Map<string, StubCard>();
  const idsByFilename = new Map<string, string>();
  const answers = new Map<string, { revision: number; draft: ScanDraft }>();
  const database = () => new Database(path.join(OPEN_DATA_DIR, DB_FILE), { fileMustExist: true, timeout: 10_000 });
  let waited = false;
  let tail: Promise<unknown> = Promise.resolve();
  const boundary = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
  const persistResult = (id: string, card: StubCard, revision?: number): ScanDraft => {
    const identification: Identification = {
      game: (card.game ?? "pokemon") as Identification["game"], name: card.name, sport: null,
      set_name: card.set_name ?? "Base Set", set_code: null, card_number: card.card_number ?? null,
      year: 1999, rarity: null, variant: null, language: "English", manufacturer: null, subject: null,
      grading: { company: null, grade: null, cert_number: null }, condition_notes: null,
      confidence: card.confidence ?? 0.95, alternatives: [], search_query: card.name,
    };
    const db = database();
    try {
      setDb(db);
      // Publish claim+result atomically: the server must never observe an
      // identifying token owned by this test process. Close before responding.
      return db.transaction(() => {
        const current = getScanDraft(id);
        if (!current) throw new Error("The fixture upload has not been saved");
        const claim = claimScanIdentification(id, revision ?? current.revision);
        return finishScanIdentification(id, claim.token, identification);
      }).immediate();
    } finally { setDb(undefined); db.close(); }
  };

  // Bind the answer to the photo before forwarding its upload. Concurrent upload
  // completion, retries and reloads cannot consume another draft's answer.
  await page.route("**/api/uploads", async (route) => {
    const request = route.request();
    const body = request.postDataBuffer();
    if (request.method() !== "POST" || !body) return route.continue();
    const contentType = request.headers()["content-type"];
    if (!contentType) throw new Error("Expected a multipart upload");
    const form = await new Response(new Uint8Array(body), { headers: { "Content-Type": contentType } }).formData();
    const id = form.get("draftId");
    if (typeof id === "string") {
      const file = form.get("files");
      const card = file instanceof File ? byFilename.get(file.name) : undefined;
      if (!card) throw new Error("Unexpected scan photo: no fixture outcome is registered");
      const previous = byDraft.get(id);
      if (previous && previous !== card) throw new Error("One draft was reused for two fixture photos");
      byDraft.set(id, card);
      idsByFilename.set((file as File).name, id);
    }
    // Waiting for the real response also lets fixture teardown drain uploads.
    await route.fulfill({ response: await boundary(() => route.fetch()) });
  });

  await page.route("**/api/scan-drafts/*/identify", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const card = byDraft.get(id);
    if (!card) throw new Error(`Identification requested for an unregistered draft: ${id}`);
    if (waitFirst && !waited) {
      waited = true;
      await route.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: { error: "Identifier busy" } });
      return;
    }
    const body = route.request().postDataJSON() as { revision: number };
    const draft = await boundary(async () => {
      const replay = answers.get(id);
      if (replay?.revision === body.revision) return replay.draft;
      const result = persistResult(id, card, body.revision);
      answers.set(id, { revision: body.revision, draft: result });
      return result;
    });
    await route.fulfill({ status: 200, json: { draft } });
  });

  // Production SQLite writes share one process. Serialize the foreign fixture
  // writer with real commits to avoid artificial cross-process lock conflicts.
  await page.route("**/api/scan-drafts/*/commit", async (route) => {
    const response = await boundary(() => route.fetch());
    await route.fulfill({ response });
  });

  await page.route("**/api/cards/*/price", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const response = await page.request.get(route.request().url().replace(/\/price$/, ""));
    const { card } = await response.json();
    const fetchedAt = new Date().toISOString();
    await route.fulfill({ status: 200, json: { card, stored: false, snapshot: {
      id: 0, cardId: card.id, fetchedAt, summary: {
        currency: "USD", fetchedAt, ungraded: null, ungradedSource: null,
        graded: {}, gradedSource: null, estimatedGraded: {}, yourCopyValue: null,
        yourCopyBasis: "No price lookup in scan tests", quotes: [], errors: [],
      },
    } } });
  });

  return {
    suffix, photos,
    name(index: number): string {
      const card = outcomes[index];
      if (!card) throw new Error("No fixture card at index " + index);
      return card.name;
    },
    async publishResult(index: number, update: Partial<StubCard>) {
      const card = outcomes[index], photo = photos[index];
      const id = photo && idsByFilename.get(photo.name);
      if (!card || !id) throw new Error("Upload the fixture photo before publishing its result");
      return boundary(async () => persistResult(id, { ...card, ...update }));
    },
    async drafts(): Promise<ScanDraft[]> {
      const response = await page.request.get("/api/scan-drafts");
      expect(response.ok()).toBe(true);
      return ((await response.json()) as { drafts: ScanDraft[] }).drafts.filter((draft) => byDraft.has(draft.id));
    },
    async cleanup() {
      await tail;
      const db = database();
      let cardIds: number[];
      try {
        cardIds = db.transaction(() => {
          const owned = new Set<number>();
          for (const id of byDraft.keys()) {
            const row = db.prepare("SELECT card_id FROM scan_drafts WHERE id=?").get(id) as { card_id: number | null } | undefined;
            if (row?.card_id) owned.add(row.card_id);
            db.prepare("DELETE FROM scan_drafts WHERE id=?").run(id);
          }
          return [...owned];
        }).immediate();
      } finally { db.close(); }
      for (const id of cardIds) expect((await page.request.delete(`/api/cards/${id}`)).ok()).toBe(true);
      // Remaining photos belong to the temporary test directory and are removed
      // after the servers stop; no unrelated draft or card is touched.
    },
  };
}

type ScanFixture = Awaited<ReturnType<typeof stubScans>>;
export const test = base.extend<{ scan: (cards: StubCard[], waitFirst?: boolean) => Promise<ScanFixture> }>({
  scan: async ({ page }, provideFixture) => {
    const fixtures: ScanFixture[] = [];
    try {
      await provideFixture(async (cards, waitFirst) => {
        const fixture = await stubScans(page, cards, waitFirst);
        fixtures.push(fixture);
        return fixture;
      });
    } finally {
      await page.goto("about:blank");
      await page.unrouteAll({ behavior: "wait" });
      for (const fixture of fixtures) await fixture.cleanup();
    }
  },
});
