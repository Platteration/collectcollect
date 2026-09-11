import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Say what went wrong on the server, where it can be found later.
 *
 * Every 5xx passes through here. The response carries a sentence for the
 * person; the log carries the stack for whoever has to work out why.
 */
export function logError(scope: string, e: unknown): void {
  console.error(`[${scope}]`, e instanceof Error ? (e.stack ?? e.message) : e);
}

/**
 * A 413 when the request announces a body larger than `max`, or null.
 *
 * Checked before the body is read: an upload that is going to be refused for
 * its size should be refused before it has been buffered in full.
 */
export function tooLarge(request: Request, max: number, message: string) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return jsonError(message, 413);
  return null;
}

/** Whether a string is somewhere the server may POST to on its own: an http(s) URL. */
export function isWebhookUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A route parameter as a row id, or null.
 *
 * Only the digits of a positive integer: `Number()` would take "1e3", " 1",
 * "0x10" and "1.0" as ids, and an id that reaches the database in more than one
 * spelling is an id that can be reached in more than one way.
 */
export function parseId(raw: string): number | null {
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}
