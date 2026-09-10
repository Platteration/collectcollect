import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** 429 with the Retry-After the limiter worked out. */
export function tooManyRequests(message: string, retryAfter: number) {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfter))) } },
  );
}

/**
 * A cheap refusal before the body is read. Every real size check in this app
 * runs after the whole request has been materialised in memory, which is fine
 * for a body that is merely over the limit and useless against a multi-gigabyte
 * one. Content-Length is absent on a chunked request, which must still be let
 * through to the check that counts.
 */
export function declaredTooLarge(request: Request, maxBytes: number): boolean {
  const declared = request.headers.get("content-length");
  if (!declared) return false;
  const length = Number(declared);
  return Number.isFinite(length) && length > maxBytes;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
