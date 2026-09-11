import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
