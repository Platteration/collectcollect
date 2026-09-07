import { getCard, latestSnapshot, updateCard } from "./cards";
import { getDb } from "./db";
import { gradeKey } from "./pricing";
import type { Game, Submission, SubmissionCard, SubmissionStatus } from "./types";
import { SUBMISSION_STATUSES } from "./types";

interface SubmissionRow {
  id: number;
  name: string;
  company: string;
  service_level: string | null;
  fee_per_card: number;
  shipping: number;
  status: string;
  sent_at: string | null;
  returned_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface SubmissionCardRow {
  card_id: number;
  raw_value: number | null;
  expected_value: number | null;
  returned_grade: string | null;
  returned_value: number | null;
  name: string;
  game: string;
  set_name: string | null;
  card_number: string | null;
  year: number | null;
  image_path: string | null;
  reference_image_url: string | null;
}

function cardsFor(submissionId: number): SubmissionCard[] {
  const rows = getDb()
    .prepare(
      `SELECT sc.card_id, sc.raw_value, sc.expected_value, sc.returned_grade, sc.returned_value,
              c.name, c.game, c.set_name, c.card_number, c.year, c.image_path, c.reference_image_url
       FROM submission_cards sc JOIN cards c ON c.id = sc.card_id
       WHERE sc.submission_id = ? ORDER BY sc.id`,
    )
    .all(submissionId) as SubmissionCardRow[];
  return rows.map((r) => ({
    cardId: r.card_id,
    rawValue: r.raw_value,
    expectedValue: r.expected_value,
    returnedGrade: r.returned_grade,
    returnedValue: r.returned_value,
    name: r.name,
    game: r.game as Game,
    detail: [r.set_name, r.card_number ? `#${r.card_number}` : null, r.year].filter(Boolean).join(" · ") || "—",
    imagePath: r.image_path,
    referenceImageUrl: r.reference_image_url,
  }));
}

function rowToSubmission(r: SubmissionRow): Submission {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    serviceLevel: r.service_level,
    feePerCard: r.fee_per_card,
    shipping: r.shipping,
    status: (r.status in SUBMISSION_STATUSES ? r.status : "draft") as SubmissionStatus,
    sentAt: r.sent_at,
    returnedAt: r.returned_at,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cards: cardsFor(r.id),
  };
}

export interface SubmissionInput {
  name?: string;
  company?: string;
  serviceLevel?: string | null;
  feePerCard?: number;
  shipping?: number;
  notes?: string | null;
}

const str = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || null;
};
const nonNeg = (v: unknown, fallback = 0) => {
  const n = Number(v ?? fallback);
  if (!Number.isFinite(n) || n < 0) throw new Error("Fees must be a number of at least zero");
  return n;
};

export function createSubmission(input: SubmissionInput): Submission {
  const company = str(input.company);
  if (!company) throw new Error("Which grading company is this going to?");
  const now = new Date().toISOString();
  const id = getDb()
    .prepare(
      `INSERT INTO submissions (name, company, service_level, fee_per_card, shipping, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    )
    .run(
      str(input.name) ?? `${company} submission`,
      company,
      str(input.serviceLevel),
      nonNeg(input.feePerCard),
      nonNeg(input.shipping),
      str(input.notes),
      now,
      now,
    ).lastInsertRowid;
  return getSubmission(Number(id))!;
}

export function getSubmission(id: number): Submission | null {
  const row = getDb().prepare("SELECT * FROM submissions WHERE id = ?").get(id) as SubmissionRow | undefined;
  return row ? rowToSubmission(row) : null;
}

export function listSubmissions(): Submission[] {
  const rows = getDb().prepare("SELECT * FROM submissions ORDER BY created_at DESC").all() as SubmissionRow[];
  return rows.map(rowToSubmission);
}

export function deleteSubmission(id: number): boolean {
  const sub = getSubmission(id);
  if (!sub) return false;
  // Cards go back to being planned rather than staying stranded "at the grader".
  for (const c of sub.cards) {
    const card = getCard(c.cardId);
    if (card && card.gradingStatus === "submitted") updateCard(card.id, { gradingStatus: "planned" });
  }
  return getDb().prepare("DELETE FROM submissions WHERE id = ?").run(id).changes > 0;
}

/** Add a card, capturing what it is worth raw and what gem mint would be worth today. */
export function addCard(submissionId: number, cardId: number): Submission {
  const sub = getSubmission(submissionId);
  if (!sub) throw new Error("Submission not found");
  if (sub.status === "returned") throw new Error("This submission is closed");
  const card = getCard(cardId);
  if (!card) throw new Error("Card not found");
  if (card.grade) throw new Error(`${card.name} is already graded`);
  const summary = latestSnapshot(cardId)?.summary;
  const expected = summary ? (summary.graded["PSA 10"] ?? summary.estimatedGraded["PSA 10"] ?? null) : null;
  getDb()
    .prepare(
      `INSERT INTO submission_cards (submission_id, card_id, raw_value, expected_value)
       VALUES (?, ?, ?, ?) ON CONFLICT (submission_id, card_id) DO NOTHING`,
    )
    .run(submissionId, cardId, summary?.yourCopyValue ?? summary?.ungraded ?? null, expected);
  touch(submissionId);
  return getSubmission(submissionId)!;
}

export function removeCard(submissionId: number, cardId: number): Submission {
  getDb().prepare("DELETE FROM submission_cards WHERE submission_id = ? AND card_id = ?").run(submissionId, cardId);
  const card = getCard(cardId);
  if (card && card.gradingStatus === "submitted") updateCard(card.id, { gradingStatus: "planned" });
  touch(submissionId);
  const sub = getSubmission(submissionId);
  if (!sub) throw new Error("Submission not found");
  return sub;
}

/** Mark as sent: every card in the batch moves to "at the grader". */
export function markSent(submissionId: number, sentAt?: string): Submission {
  const sub = getSubmission(submissionId);
  if (!sub) throw new Error("Submission not found");
  if (sub.cards.length === 0) throw new Error("Add at least one card before sending");
  const when = sentAt ? new Date(sentAt) : new Date();
  if (Number.isNaN(when.getTime())) throw new Error("Sent date is not a valid date");
  getDb()
    .prepare("UPDATE submissions SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?")
    .run(when.toISOString(), new Date().toISOString(), submissionId);
  for (const c of sub.cards) updateCard(c.cardId, { gradingStatus: "submitted" });
  return getSubmission(submissionId)!;
}

export interface GradeResult {
  cardId: number;
  grade: string;
}

/**
 * Record what came back. Each graded card takes the company and grade, so it
 * is valued as a graded copy from here on, and the value at that grade is
 * captured for the batch's realized outcome. Grades can arrive in more than
 * one pass: the batch only closes once every card has one, so a partial entry
 * does not strand the rest at the grader.
 */
export function recordReturn(submissionId: number, results: GradeResult[], returnedAt?: string): Submission {
  const sub = getSubmission(submissionId);
  if (!sub) throw new Error("Submission not found");
  const when = returnedAt ? new Date(returnedAt) : new Date();
  if (Number.isNaN(when.getTime())) throw new Error("Return date is not a valid date");
  const inBatch = new Set(sub.cards.map((c) => c.cardId));
  for (const r of results) {
    if (!inBatch.has(r.cardId)) throw new Error(`Card ${r.cardId} is not in this submission`);
    const grade = String(r.grade ?? "").trim();
    if (!grade) continue;
    const summary = latestSnapshot(r.cardId)?.summary;
    const key = gradeKey(sub.company, grade);
    const value = summary && key ? (summary.graded[key] ?? summary.estimatedGraded[key] ?? null) : null;
    getDb()
      .prepare("UPDATE submission_cards SET returned_grade = ?, returned_value = ? WHERE submission_id = ? AND card_id = ?")
      .run(grade, value, submissionId, r.cardId);
    updateCard(r.cardId, { gradingCompany: sub.company, grade, gradingStatus: "undecided" });
  }
  const after = getSubmission(submissionId)!;
  const complete = after.cards.length > 0 && after.cards.every((c) => c.returnedGrade);
  getDb()
    .prepare("UPDATE submissions SET status = ?, returned_at = ?, updated_at = ? WHERE id = ?")
    .run(complete ? "returned" : "sent", complete ? when.toISOString() : null, new Date().toISOString(), submissionId);
  return getSubmission(submissionId)!;
}

export function updateSubmission(id: number, input: SubmissionInput): Submission {
  const sub = getSubmission(id);
  if (!sub) throw new Error("Submission not found");
  getDb()
    .prepare(
      `UPDATE submissions SET name = ?, company = ?, service_level = ?, fee_per_card = ?, shipping = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      str(input.name) ?? sub.name,
      str(input.company) ?? sub.company,
      input.serviceLevel === undefined ? sub.serviceLevel : str(input.serviceLevel),
      input.feePerCard === undefined ? sub.feePerCard : nonNeg(input.feePerCard),
      input.shipping === undefined ? sub.shipping : nonNeg(input.shipping),
      input.notes === undefined ? sub.notes : str(input.notes),
      new Date().toISOString(),
      id,
    );
  return getSubmission(id)!;
}

function touch(id: number) {
  getDb().prepare("UPDATE submissions SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}
