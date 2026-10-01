import { z } from "zod";
import { GRADING_AGENCIES, type Centering, type CenteringSide, type GradingReport } from "../types";
import { badRatio, isEmptyCentering, looksLikeOneRatio, parseRatio, parseSide } from "./centering";

/**
 * What a card's centering and grading report have to look like before they
 * are stored. The same readers serve the API, the repository and the file
 * reader, so a value refused here is refused everywhere, with the same words.
 */

function readSide(value: unknown): CenteringSide {
  if (value === null || value === undefined || value === "") return { lr: null, tb: null };
  if (typeof value === "string") return parseSide(value);
  if (typeof value !== "object" || Array.isArray(value)) throw badRatio(value);
  const o = value as { lr?: unknown; tb?: unknown };
  // A whole side typed into the left/right box, "54L/46R 49T/51B", fills both axes.
  if (typeof o.lr === "string" && o.lr.trim() && !looksLikeOneRatio(o.lr)) {
    const side = parseSide(o.lr);
    const tb = o.tb === null || o.tb === undefined || o.tb === "" ? side.tb : parseRatio(o.tb);
    return { lr: side.lr, tb };
  }
  return { lr: parseRatio(o.lr), tb: parseRatio(o.tb) };
}

/**
 * Centering from a form, the API, a stored row or a file: each axis as text
 * or a pair. Nothing measured at all is null; a ratio that is not one throws.
 */
export function readCentering(value: unknown): Centering | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const front = parseSide(value);
    const c: Centering = { front, back: { lr: null, tb: null } };
    return isEmptyCentering(c) ? null : c;
  }
  if (typeof value !== "object" || Array.isArray(value)) throw badRatio(value);
  const o = value as { front?: unknown; back?: unknown };
  const c: Centering = { front: readSide(o.front), back: readSide(o.back) };
  return isEmptyCentering(c) ? null : c;
}

// Numbers may arrive as the text of a form field; blank means not given.
const numberish = (schema: z.ZodType<number>) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : Number(v)) : v), schema.nullish());
const subgrade = numberish(z.number().min(1).max(10));
const score = numberish(z.number().int().min(1).max(1000));
const count = numberish(z.number().int().min(0).max(99));
const population = numberish(z.number().int().min(0).max(100_000_000));
const text = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullish());
const isHttps = (s: string) => {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
};
const https = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(2048).refine(isHttps, "has to be an https:// address").nullish());

const SubgradeSchema = z.object({ front: subgrade, back: subgrade }).nullish();

export const GradingReportSchema = z.object({
  company: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(GRADING_AGENCIES)),
  cert: z.string().trim().min(1, "needs the cert number").max(40),
  source: z.enum(["psa", "manual"]),
  checkedAt: z.string().refine((s) => Number.isFinite(Date.parse(s)), "has to be a date"),
  label: text(60),
  grade: text(20),
  gradeText: text(60),
  gradedAt: text(40),
  subgrades: z.object({ centering: SubgradeSchema, corners: SubgradeSchema, edges: SubgradeSchema, surface: SubgradeSchema }).nullish(),
  tag: z
    .object({
      score,
      rollups: z.object({ centering: score, corners: score, edges: score, surface: score }).nullish(),
      composite: z.object({ front: score, back: score }).nullish(),
      dings: z.object({ cornersFront: count, cornersBack: count, edgesFront: count, edgesBack: count, surfaceFront: count, surfaceBack: count }).nullish(),
    })
    .nullish(),
  population: z.object({ atGrade: population, total: population, higher: population }).nullish(),
  images: z.object({ front: https, back: https }).nullish(),
  url: https,
  identity: z.object({ subject: text(200), brand: text(200), year: text(200), cardNumber: text(200), variety: text(200), category: text(200) }).nullish(),
});

const orNull = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);
const allNull = (o: Record<string, unknown>): boolean => Object.values(o).every((v) => v === null);

/**
 * A grading report from the API, a form or a file, checked and filled out so
 * every field is there: a block the company does not publish is null, never
 * half-present. A report that is not one throws, naming the field.
 */
export function readGradingReport(value: unknown): GradingReport | null {
  if (value === null || value === undefined || value === "") return null;
  const checked = GradingReportSchema.safeParse(value);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const where = issue?.path.map(String).join(".") || "report";
    throw new Error(`The grading report is not something this app can store: ${where} ${issue?.message ?? "is wrong"}`);
  }
  const r = checked.data;
  const sub = (s: { front?: number | null; back?: number | null } | null | undefined) => ({ front: orNull(s?.front), back: orNull(s?.back) });
  const subgrades = r.subgrades ? { centering: sub(r.subgrades.centering), corners: sub(r.subgrades.corners), edges: sub(r.subgrades.edges), surface: sub(r.subgrades.surface) } : null;
  const tag = r.tag
    ? {
        score: orNull(r.tag.score),
        rollups: { centering: orNull(r.tag.rollups?.centering), corners: orNull(r.tag.rollups?.corners), edges: orNull(r.tag.rollups?.edges), surface: orNull(r.tag.rollups?.surface) },
        composite: { front: orNull(r.tag.composite?.front), back: orNull(r.tag.composite?.back) },
        dings: {
          cornersFront: orNull(r.tag.dings?.cornersFront),
          cornersBack: orNull(r.tag.dings?.cornersBack),
          edgesFront: orNull(r.tag.dings?.edgesFront),
          edgesBack: orNull(r.tag.dings?.edgesBack),
          surfaceFront: orNull(r.tag.dings?.surfaceFront),
          surfaceBack: orNull(r.tag.dings?.surfaceBack),
        },
      }
    : null;
  const population = r.population ? { atGrade: orNull(r.population.atGrade), total: orNull(r.population.total), higher: orNull(r.population.higher) } : null;
  const images = r.images ? { front: orNull(r.images.front), back: orNull(r.images.back) } : null;
  const identity = r.identity
    ? { subject: orNull(r.identity.subject), brand: orNull(r.identity.brand), year: orNull(r.identity.year), cardNumber: orNull(r.identity.cardNumber), variety: orNull(r.identity.variety), category: orNull(r.identity.category) }
    : null;
  return {
    company: r.company,
    cert: r.cert,
    source: r.source,
    checkedAt: r.checkedAt,
    label: orNull(r.label),
    grade: orNull(r.grade),
    gradeText: orNull(r.gradeText),
    gradedAt: orNull(r.gradedAt),
    subgrades: subgrades && Object.values(subgrades).some((s) => s.front !== null || s.back !== null) ? subgrades : null,
    tag: tag && !(tag.score === null && allNull(tag.rollups) && allNull(tag.composite) && allNull(tag.dings)) ? tag : null,
    population: population && !allNull(population) ? population : null,
    images: images && !allNull(images) ? images : null,
    url: orNull(r.url),
    identity: identity && !allNull(identity) ? identity : null,
  };
}
