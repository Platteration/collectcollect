import { NextResponse } from "next/server";

// Pure checks with no dependencies live in ./net so that code which must not
// pull Next in (the seed scripts, the settings module) can use them; they are
// re-exported here for the routes that already import from this file.
export { isPrivateAddress, isPrivateHost, isSecureRequest, isWebhookUrl, trustProxy } from "./net";

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

export class BodyLimitError extends Error {
  readonly status = 413;
  constructor(max: number) {
    super(`Request body exceeds the ${max} byte limit`);
    this.name = "BodyLimitError";
  }
}

/** Enforce actual bytes, including chunked bodies and extra multipart fields. */
export async function readBodyLimited(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await request.body?.cancel().catch(() => undefined);
    throw new BodyLimitError(max);
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        throw new BodyLimitError(max);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function readJsonLimited<T = unknown>(request: Request, max = 1024 * 1024): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readBodyLimited(request, max))) as T;
}

export async function readFormDataLimited(request: Request, max: number): Promise<FormData> {
  const body = await readBodyLimited(request, max);
  return new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
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
