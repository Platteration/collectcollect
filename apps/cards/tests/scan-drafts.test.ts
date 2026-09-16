import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { createCard, deleteCard, getCard, listCards } from "@/lib/cards";
import { listLots } from "@/lib/acquisitions";
import { claimScanIdentification, commitScanDraft, createScanDraft, discardScanDraft, finishScanIdentification, getScanDraft, listScanDrafts, patchScanDraft } from "@/lib/scan-drafts";
import type { Identification } from "@/lib/types";

const identification = (name = "Pikachu", confidence = 0.95): Identification => ({
  game: "pokemon", name, sport: null, set_name: "Jungle", set_code: null, card_number: "60", year: 1999,
  rarity: null, variant: null, language: "English", manufacturer: null, subject: null,
  grading: { company: null, grade: null, cert_number: null }, condition_notes: null,
  confidence, alternatives: [], search_query: name,
});
const draft = () => createScanDraft(randomUUID(), { name: randomUUID() + ".jpg", color: null });
function identified(name = "Pikachu", confidence = 0.95) {
  const d = draft(), claim = claimScanIdentification(d.id, d.revision);
  return finishScanIdentification(d.id, claim.token, identification(name, confidence));
}
beforeEach(() => setDb(openDatabase(":memory:")));

describe("persistent scan inbox", () => {
  it("keeps an upload receipt and identification without creating a holding", () => {
    const d = identified("Uncertain", 0.4);
    expect(getScanDraft(d.id)).toMatchObject({ status: "review", input: { name: "Uncertain" }, identification: { confidence: 0.4 } });
    expect(listCards()).toEqual([]);
    expect(createScanDraft(d.id, { name: randomUUID() + ".jpg", color: null })).toEqual(d);
    expect(() => commitScanDraft(d.id, d.revision, "auto")).toThrow(/Review/);
  });
  it("commits once across network replay and merges a different scan once", () => {
    const first = identified();
    const saved = commitScanDraft(first.id, first.revision, "auto").draft;
    expect(saved.status).toBe("committed");
    expect(commitScanDraft(first.id, first.revision, "auto").draft).toEqual(saved);
    const second = identified();
    const merged = commitScanDraft(second.id, second.revision, "auto").draft;
    commitScanDraft(second.id, second.revision, "auto");
    expect(merged.result).toBe("merged");
    expect(getCard(saved.cardId!)?.quantity).toBe(2);
    expect(listLots(saved.cardId!)).toHaveLength(2);
  });
  it("retains owner purchase facts, notes, location and manual pricing across re-identification", () => {
    const d = identified("Needs another look", 0.3);
    const ownerInput = { quantity: 3, purchasePrice: 0, notes: "Gift from a friend", location: "Binder 2", manualUngraded: 12, manualGraded: { "PSA 10": 40 }, gradingStatus: "keep_raw" as const };
    const edited = patchScanDraft(d.id, d.revision, { input: ownerInput });
    const claim = claimScanIdentification(d.id, edited.revision);
    const result = finishScanIdentification(d.id, claim.token, { ...identification("Corrected identity"), condition_notes: "Model condition notes" });
    expect(result.input).toMatchObject({ ...ownerInput, name: "Corrected identity" });
    const saved = commitScanDraft(result.id, result.revision, "auto").draft;
    expect(getCard(saved.cardId!)).toMatchObject({ ...ownerInput, name: "Corrected identity" });
    expect(listLots(saved.cardId!)[0]).toMatchObject({ quantity: 3, remaining: 3, unitCost: 0 });
  });
  it("keeps deliberately cleared notes while retaining the new model assessment", () => {
    const d = draft();
    const edited = patchScanDraft(d.id, d.revision, { input: { notes: null, purchasePrice: null } });
    const claim = claimScanIdentification(d.id, edited.revision);
    const result = finishScanIdentification(d.id, claim.token, { ...identification(), condition_notes: "Visible wear" });
    expect(result.input).toMatchObject({ notes: null, purchasePrice: null });
    expect(result.identification?.condition_notes).toBe("Visible wear");
  });
  it("does not resurrect a deleted holding when an old commit is replayed", () => {
    const d = identified();
    const saved = commitScanDraft(d.id, d.revision, "auto").draft;
    deleteCard(saved.cardId!);
    expect(commitScanDraft(d.id, d.revision, "auto").draft.cardId).toBe(saved.cardId);
    expect(listCards()).toEqual([]);
  });
  it("rolls the card and lot back if writing the receipt fails", () => {
    const d = identified();
    getDb().exec("CREATE TRIGGER refuse_scan_commit BEFORE UPDATE ON scan_drafts WHEN NEW.status='committed' BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");
    expect(() => commitScanDraft(d.id, d.revision, "auto")).toThrow(/receipt unavailable/);
    expect(listCards()).toEqual([]);
    expect(getScanDraft(d.id)?.status).toBe("ready");
  });
  it("rejects stale tabs, invalid details and edits during identification", () => {
    const d = draft();
    const changed = patchScanDraft(d.id, d.revision, { input: { name: "Manually named", game: "mtg" } });
    expect(() => patchScanDraft(d.id, d.revision, { hint: "old tab" })).toThrow(/another tab/);
    expect(() => patchScanDraft(d.id, changed.revision, { input: { name: 42 as never } })).toThrow(/Card name/);
    claimScanIdentification(d.id, changed.revision);
    expect(() => patchScanDraft(d.id, changed.revision + 1, { hint: "interrupt" })).toThrow(/still running/);
  });
  it("makes an interrupted attempt retryable and rejects its late result", () => {
    const d = draft(), claim = claimScanIdentification(d.id, d.revision);
    getDb().prepare("UPDATE scan_drafts SET started_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(d.id);
    expect(listScanDrafts()[0]?.status).toBe("failed");
    expect(() => finishScanIdentification(d.id, claim.token, identification())).toThrow(/expired/);
  });
  it("recovers immediately after reopening the database but leaves live attempts alone", () => {
    const folder = process.env.DATA_DIR!;
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, "restart.db");
    const first = openDatabase(file); setDb(first);
    const d = draft(); const claim = claimScanIdentification(d.id, d.revision);
    expect(listScanDrafts()[0]?.status).toBe("identifying");
    first.close();
    const reopened = openDatabase(file); setDb(reopened);
    // A restore can contain the same attempt token. A late reply must be rejected
    // even before an inbox read has recovered the orphaned attempt.
    expect(() => finishScanIdentification(d.id, claim.token, identification())).toThrow(/expired/);
    expect(getScanDraft(d.id)?.status).toBe("identifying");
    expect(listScanDrafts()[0]).toMatchObject({ status: "failed", message: expect.stringMatching(/interrupted/) });
    expect(() => finishScanIdentification(d.id, claim.token, identification())).toThrow(/expired/);
    reopened.close(); setDb(undefined);
  });
  it("never hides older review work behind completed receipts", () => {
    const d = identified("Older review", 0.2);
    const now = new Date(Date.now() + 1000).toISOString();
    const insert = getDb().prepare("INSERT INTO scan_drafts (id,uploads,status,created_at,updated_at) VALUES (?, '[]', 'committed', ?, ?)");
    for (let n = 0; n < 600; n++) insert.run(randomUUID(), now, now);
    const inbox = listScanDrafts();
    expect(inbox.some((entry) => entry.id === d.id)).toBe(true);
    expect(inbox.filter((entry) => entry.status === "committed")).toHaveLength(100);
  });
  it("requires an explicit compatible merge for ambiguous copies", () => {
    const slab = createCard({ game: "pokemon", name: "Pikachu", setName: "Jungle", cardNumber: "60", grade: "10", gradingCompany: "PSA" });
    const d = identified();
    const review = commitScanDraft(d.id, d.revision, "auto");
    expect(review.draft.status).toBe("review");
    expect(review.candidates?.[0]?.id).toBe(slab.id);
    expect(() => commitScanDraft(d.id, review.draft.revision, "merge", slab.id)).toThrow(/different grades/);
    expect(commitScanDraft(d.id, review.draft.revision, "separate").draft.result).toBe("created");
    expect(listCards()).toHaveLength(2);
  });
  it("keeps discarded receipts and unfinished work beyond completed history", () => {
    const d = draft();
    expect(discardScanDraft(d.id, d.revision).status).toBe("discarded");
    expect(() => commitScanDraft(d.id, d.revision, "separate")).toThrow(/finished/);
    expect(listScanDrafts()).toEqual([]);
  });
});
