import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db";
import { addAcquisition, createCard, discardDeferredMirror, findSimilar, flushDeferredMirror, getCard, intakeCardWithin, normalizeInput } from "./cards";
import { isValidUploadName } from "./images";
import { isGame, type CardInput, type Identification } from "./types";
import { inputFromIdentification, type ScanDraft } from "./scan-types";

export class DraftError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const globalForScans = globalThis as unknown as { __collectcollectScanAttempts?: Map<string, Database.Database> };
const activeAttempts = globalForScans.__collectcollectScanAttempts ??= new Map<string, Database.Database>();
export function validDraftId(id: string): boolean { return UUID.test(id); }
interface DraftRow {
  id: string; uploads: string; accent_color: string | null; input: string; identification: string | null;
  hint: string; status: ScanDraft["status"]; message: string | null; revision: number;
  attempt: string | null; started_at: string | null; card_id: number | null; result: ScanDraft["result"];
  created_at: string; updated_at: string;
}
function decode(row: DraftRow): ScanDraft {
  return { id: row.id, uploads: JSON.parse(row.uploads), accentColor: row.accent_color, input: JSON.parse(row.input),
    identification: row.identification ? JSON.parse(row.identification) : null, hint: row.hint, status: row.status,
    message: row.message, revision: row.revision, cardId: row.card_id, result: row.result, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function getScanDraft(id: string): ScanDraft | null {
  if (!validDraftId(id)) return null;
  const row = getDb().prepare("SELECT * FROM scan_drafts WHERE id = ?").get(id) as DraftRow | undefined;
  return row ? decode(row) : null;
}
export function listScanDrafts(): ScanDraft[] {
  // This is a single-process catalog. After a restart or restore, no live request
  // owns the stored token; recover immediately instead of waiting for its lease.
  const db = getDb();
  const working = db.prepare("SELECT attempt, started_at FROM scan_drafts WHERE status='identifying'").all() as Array<{ attempt: string | null; started_at: string | null }>;
  for (const row of working) {
    if (row.attempt && activeAttempts.get(row.attempt) === db && row.started_at && Date.parse(row.started_at) > Date.now() - 360_000) continue;
    db.prepare("UPDATE scan_drafts SET status='failed', message='Identification was interrupted. Retry to continue.', attempt=NULL, revision=revision+1, updated_at=? WHERE status='identifying' AND attempt IS ?")
      .run(new Date().toISOString(), row.attempt);
    if (row.attempt) activeAttempts.delete(row.attempt);
  }
  return (getDb().prepare("SELECT * FROM scan_drafts WHERE status NOT IN ('committed','discarded') OR id IN (SELECT id FROM scan_drafts WHERE status='committed' ORDER BY updated_at DESC LIMIT 100) ORDER BY created_at DESC, id").all() as DraftRow[]).map(decode);
}
export function createScanDraft(id: string, upload: { name: string; color: string | null }): ScanDraft {
  if (!validDraftId(id) || !isValidUploadName(upload.name)) throw new DraftError("Invalid scan or upload identifier");
  const now = new Date().toISOString();
  getDb().prepare("INSERT INTO scan_drafts (id, uploads, accent_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
    .run(id, JSON.stringify([upload.name]), upload.color, now, now);
  return requireDraft(id);
}
function requireDraft(id: string): ScanDraft {
  const draft = getScanDraft(id);
  if (!draft) throw new DraftError("Scan not found", 404);
  return draft;
}
function editable(id: string, revision: unknown): ScanDraft {
  const draft = requireDraft(id);
  if (draft.status === "committed" || draft.status === "discarded") throw new DraftError("This scan is already finished", 409);
  if (draft.revision !== revision) throw new DraftError("This scan changed in another tab. Reload it before saving.", 409);
  if (draft.status === "identifying") throw new DraftError("Identification is still running", 409);
  return draft;
}
export function patchScanDraft(id: string, revision: unknown, patch: { input?: Partial<CardInput>; hint?: string; uploads?: string[] }): ScanDraft {
  return getDb().transaction(() => {
    const draft = editable(id, revision);
    if (patch.input !== undefined && (!patch.input || typeof patch.input !== "object" || Array.isArray(patch.input))) throw new DraftError("Expected card details");
    const input = { ...draft.input, ...patch.input };
    if (input.game !== undefined && !isGame(input.game)) throw new DraftError("Unknown card game");
    if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 1000)) throw new DraftError("Card name must be text of at most 1000 characters");
    // Drafts may have no name yet; all supplied domain values must still be valid.
    normalizeInput({ ...input, game: input.game ?? "pokemon", name: input.name?.trim() || "Unidentified card" });
    const uploads = patch.uploads ?? draft.uploads;
    if (!Array.isArray(uploads) || !uploads.length || uploads.length > 4 || !uploads.every((n) => typeof n === "string" && isValidUploadName(n))) throw new DraftError("Provide one to four saved photos");
    if (patch.hint !== undefined && (typeof patch.hint !== "string" || patch.hint.length > 2000)) throw new DraftError("Hint must be at most 2000 characters");
    if (JSON.stringify(input).length > 40_000) throw new DraftError("Card details are too large");
    getDb().prepare("UPDATE scan_drafts SET input=?, hint=?, uploads=?, status='review', message=NULL, revision=revision+1, updated_at=? WHERE id=?")
      .run(JSON.stringify(input), patch.hint ?? draft.hint, JSON.stringify(uploads), new Date().toISOString(), id);
    return requireDraft(id);
  })();
}
export function claimScanIdentification(id: string, revision: unknown): { draft: ScanDraft; token: string } {
  return getDb().transaction(() => {
    editable(id, revision);
    const token = randomUUID();
    const now = new Date().toISOString();
    getDb().prepare("UPDATE scan_drafts SET status='identifying', attempt=?, started_at=?, message=NULL, revision=revision+1, updated_at=? WHERE id=?").run(token, now, now, id);
    activeAttempts.set(token, getDb());
    return { draft: requireDraft(id), token };
  })();
}
export function finishScanIdentification(id: string, token: string, identification: Identification | null, error?: string): ScanDraft {
  try {
    const origin = activeAttempts.get(token);
    // A restore closes the original connection. Never apply a late model answer
    // to the replacement database, even if its backup contains the same token.
    if (!origin?.open || origin !== getDb()) throw new DraftError("This identification attempt has expired", 409);
    return origin.transaction(() => {
    const row = getDb().prepare("SELECT * FROM scan_drafts WHERE id=?").get(id) as DraftRow | undefined;
    if (!row || row.status !== "identifying" || row.attempt !== token) throw new DraftError("This identification attempt has expired", 409);
    const status = identification ? identification.confidence >= 0.8 ? "ready" : "review" : "failed";
    const message = identification && identification.confidence < 0.8
      ? `Only ${Math.round(identification.confidence * 100)}% sure this is ${identification.name}.`
      : error ?? null;
    const previousInput = JSON.parse(row.input) as Partial<CardInput>;
    const nextInput = identification ? { ...previousInput, ...inputFromIdentification(identification) } : previousInput;
    // Another model pass updates identity, not the owner's purchase facts,
    // storage details, pricing, grading plans or notes (including cleared notes).
    if (Object.hasOwn(previousInput, "notes")) nextInput.notes = previousInput.notes;
    getDb().prepare("UPDATE scan_drafts SET input=?, identification=?, status=?, message=?, attempt=NULL, revision=revision+1, updated_at=? WHERE id=?")
      .run(JSON.stringify(nextInput), identification ? JSON.stringify(identification) : row.identification, status, message, new Date().toISOString(), id);
    return requireDraft(id);
  })(); } finally { activeAttempts.delete(token); }
}
export function discardScanDraft(id: string, revision: unknown): ScanDraft {
  return getDb().transaction(() => {
    const current = requireDraft(id);
    if (current.status === "discarded") return current;
    editable(id, revision);
    getDb().prepare("UPDATE scan_drafts SET status='discarded', revision=revision+1, updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    return requireDraft(id);
  })();
}
export function commitScanDraft(id: string, revision: unknown, mode: "auto" | "separate" | "merge", targetId?: number): { draft: ScanDraft; candidates?: ReturnType<typeof findSimilar> } {
  try {
    const outcome = getDb().transaction(() => {
      const previous = requireDraft(id);
      if (previous.status === "committed") return { draft: previous };
      const draft = editable(id, revision);
      if (!["auto", "separate", "merge"].includes(mode)) throw new DraftError("Choose how to save this scan");
      if (mode === "auto" && (draft.status !== "ready" || !draft.identification || draft.identification.confidence < 0.8)) throw new DraftError("Review this card before saving", 409);
      const input = { ...draft.input, imagePath: draft.uploads[0], accentColor: draft.accentColor, identification: draft.identification } as CardInput;
      let result: "created" | "merged";
      let card;
      if (mode === "separate") { card = createCard(input); result = "created"; }
      else if (mode === "merge") {
        const target = targetId ? getCard(targetId) : null;
        if (!target) throw new DraftError("The destination card no longer exists", 404);
        if ((target.grade ?? null) !== (input.grade ?? null) || (target.gradingCompany ?? null) !== (input.gradingCompany ?? null)) throw new DraftError("Copies with different grades must stay separate", 409);
        if (!findSimilar(input).some((candidate) => candidate.id === target.id)) throw new DraftError("This card is not a matching duplicate", 409);
        card = addAcquisition(target.id, { quantity: input.quantity ?? 1, unitCost: input.purchasePrice });
        result = "merged";
      } else {
        const intake = intakeCardWithin(input);
        if (intake.result === "ambiguous") {
          getDb().prepare("UPDATE scan_drafts SET status='review', message='Choose which copy this matches, or save it separately.', revision=revision+1, updated_at=? WHERE id=?").run(new Date().toISOString(), id);
          return { draft: requireDraft(id), candidates: intake.candidates };
        }
        card = intake.card; result = intake.result;
      }
      if (!card) throw new DraftError("Card could not be saved", 409);
      getDb().prepare("UPDATE scan_drafts SET status='committed', card_id=?, result=?, message=NULL, revision=revision+1, updated_at=? WHERE id=?")
        .run(card.id, result, new Date().toISOString(), id);
      return { draft: requireDraft(id) };
    })();
    flushDeferredMirror();
    return outcome;
  } catch (e) { discardDeferredMirror(); throw e; }
}
