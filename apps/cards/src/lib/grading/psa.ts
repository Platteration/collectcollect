import { retryAfterMs } from "@collectcollect/core/limiter";
import type { GradingReport } from "../types";
import { AGENCIES } from "./agencies";

/**
 * PSA's public cert API: the one grading company that answers a cert number
 * by machine. A token comes from a PSA account at psacard.com/publicapi and
 * PSA approves accounts for the API, so a fresh token may be refused until
 * then; the owner can always enter the report by hand instead. One record and
 * one image list per lookup, and nothing else is ever asked of PSA.
 */
export const PSA_API = "https://api.psacard.com/publicapi";

/** PSA's free tier allows about a hundred calls a day; ten are left as slack. */
export const PSA_DAILY_LIMIT = 90;
const DAY = 24 * 3600e3;

export function isPsaConfigured(): boolean {
  return Boolean(process.env.PSA_API_TOKEN?.trim());
}

/** What went wrong at PSA, with the HTTP status the route answers and how long to wait when PSA said. */
export class PsaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "PsaError";
  }
}

/**
 * The day's budget of lookups. It refuses rather than waits: a daily window
 * is hours long, and a button that waited that long would look broken. Per
 * process and forgotten on restart; PSA's own limit still applies.
 */
export interface PsaBudget {
  take(now?: number): { ok: true } | { ok: false; retryAfterMs: number };
  /** PSA asked for a pause: nothing goes out before then. */
  cooldown(ms: number, now?: number): void;
  reset(): void;
}

export function createPsaBudget(max = PSA_DAILY_LIMIT, windowMs = DAY): PsaBudget {
  const taken: number[] = [];
  let pausedUntil = 0;
  return {
    take(now = Date.now()) {
      while (taken.length && now - taken[0]! >= windowMs) taken.shift();
      if (now < pausedUntil) return { ok: false, retryAfterMs: pausedUntil - now };
      if (taken.length >= max) {
        const oldest = taken[0];
        return { ok: false, retryAfterMs: oldest === undefined ? windowMs : windowMs - (now - oldest) };
      }
      taken.push(now);
      return { ok: true };
    },
    cooldown(ms, now = Date.now()) {
      pausedUntil = Math.max(pausedUntil, now + Math.max(0, ms));
    },
    reset() {
      taken.length = 0;
      pausedUntil = 0;
    },
  };
}

// On the global object, like the database handle: a development reload that
// made a fresh budget would forget the calls already made today.
const globalForBudget = globalThis as unknown as { __cardsPsaBudget?: PsaBudget };
let budget: PsaBudget = (globalForBudget.__cardsPsaBudget ??= createPsaBudget());

/** Tests only: replace the shared budget. */
export function setPsaBudget(next: PsaBudget): void {
  budget = globalForBudget.__cardsPsaBudget = next;
}

function waitText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
}

export type PsaLookup = { found: true; report: GradingReport; imagesSkipped: boolean } | { found: false };

const str = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const text = String(v).trim();
  return text ? text.slice(0, max) : null;
};
const int = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};
const httpsOnly = (v: unknown): string | null => {
  const text = str(v, 2048);
  if (!text) return null;
  try {
    return new URL(text).protocol === "https:" ? text : null;
  } catch {
    return null;
  }
};

/**
 * PSA's record for a cert as a grading report. Keys as PSA's Swagger names
 * them, every one optional, because the shape could not be checked live.
 * CardGrade is text ("GEM MT 10", "AUTHENTIC"); the grade is its last number.
 */
export function reportFromPsaCert(cert: string, record: Record<string, unknown>, images: GradingReport["images"], checkedAt: string): GradingReport {
  const gradeText = str(record.CardGrade, 60);
  const numbers = gradeText?.match(/\d+(?:\.\d+)?/g);
  const grade = numbers ? String(Number(numbers[numbers.length - 1])) : gradeText;
  const atGrade = int(record.TotalPopulation);
  const higher = int(record.PopulationHigher);
  const identity = {
    subject: str(record.Subject),
    brand: str(record.Brand),
    year: str(record.Year),
    cardNumber: str(record.CardNumber),
    variety: str(record.Variety),
    category: str(record.Category),
  };
  return {
    company: "PSA",
    cert,
    source: "psa",
    checkedAt,
    label: str(record.LabelType, 60),
    grade,
    gradeText,
    gradedAt: null,
    subgrades: null,
    tag: null,
    population: atGrade !== null || higher !== null ? { atGrade, total: null, higher } : null,
    images,
    url: AGENCIES.PSA.reportUrl(cert),
    identity: Object.values(identity).some((v) => v !== null) ? identity : null,
  };
}

/**
 * PSA's image list for a cert, whichever way it is shaped: an array of
 * { IsFrontImage, ImageURL }, an object holding one, or front/back keys.
 * Only https addresses are kept, since the page shows them straight from PSA.
 */
export function imagesFromPsa(body: unknown): GradingReport["images"] {
  if (!body || typeof body !== "object") return null;
  const list = Array.isArray(body) ? body : Object.values(body as Record<string, unknown>).find(Array.isArray);
  let front: string | null = null;
  let back: string | null = null;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const { IsFrontImage, ImageURL } = item as { IsFrontImage?: unknown; ImageURL?: unknown };
      const url = httpsOnly(ImageURL);
      if (!url) continue;
      if (IsFrontImage === true && !front) front = url;
      else if (IsFrontImage === false && !back) back = url;
      else if (IsFrontImage === undefined) {
        if (!front) front = url;
        else if (!back) back = url;
      }
    }
  } else {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      const url = httpsOnly(value);
      if (!url) continue;
      if (/front/i.test(key) && !front) front = url;
      else if (/back/i.test(key) && !back) back = url;
    }
  }
  return front || back ? { front, back } : null;
}

async function request(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers, signal });
  } catch (e) {
    throw new PsaError(`Could not reach PSA: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
  if (response.ok || response.status === 204) return response;
  if (response.status === 401) throw new PsaError("PSA refused the token. Check PSA_API_TOKEN, then restart the app.", 502);
  if (response.status === 403) {
    throw new PsaError("PSA has not approved this account for its API yet: it says access is limited to approved customers. Ask collectors-apis@collectors.com, or enter the report by hand.", 502);
  }
  if (response.status === 429) {
    const wait = retryAfterMs(response.headers.get("retry-after"), Date.now(), 3600e3);
    budget.cooldown(wait);
    throw new PsaError(`PSA is rate limiting this app. Try again in ${waitText(wait)}.`, 429, wait);
  }
  if (response.status === 500) {
    throw new PsaError("PSA answered with an error (HTTP 500). It sends this for an invalid token too: check PSA_API_TOKEN, then try again later.", 502);
  }
  throw new PsaError(`PSA answered HTTP ${response.status}.`, 502);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Look a cert up: the record, then the images. A cert PSA has no record of
 * is `found: false`; everything else PSA refuses is a PsaError with the
 * status the route answers. The images are never a reason to fail: a second
 * call that is refused, or over budget, is reported as skipped.
 */
export async function lookupCert(cert: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<PsaLookup> {
  const token = process.env.PSA_API_TOKEN?.trim();
  if (!token) throw new PsaError("PSA cert lookup is not set up on this server. Add PSA_API_TOKEN to the environment and restart the app.", 503);
  if (!AGENCIES.PSA.certPattern.test(cert)) throw new PsaError(`A PSA cert number is ${AGENCIES.PSA.certHint}.`, 400);
  const turn = budget.take();
  if (!turn.ok) {
    throw new PsaError(`This app has used its PSA lookups for today (${PSA_DAILY_LIMIT} a day). Try again in ${waitText(turn.retryAfterMs)}.`, 429, turn.retryAfterMs);
  }
  const headers = { authorization: `bearer ${token}`, accept: "application/json" };
  const response = await request(fetchImpl, `${PSA_API}/cert/GetByCertNumber/${cert}`, headers, signal);
  if (response.status === 204) return { found: false };
  const body = await readJson(response);
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as { PSACert?: unknown }).PSACert : null;
  if (!record || typeof record !== "object") return { found: false };

  let images: GradingReport["images"] = null;
  let imagesSkipped = false;
  if (budget.take().ok) {
    try {
      images = imagesFromPsa(await readJson(await request(fetchImpl, `${PSA_API}/cert/GetImagesByCertNumber/${cert}`, headers, signal)));
    } catch {
      imagesSkipped = true; // the cert itself was found; the owner can try the scans again later
    }
  } else {
    imagesSkipped = true;
  }
  return { found: true, report: reportFromPsaCert(cert, record as Record<string, unknown>, images, new Date().toISOString()), imagesSkipped };
}
