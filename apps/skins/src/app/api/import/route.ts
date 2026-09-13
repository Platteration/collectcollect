import { NextResponse } from "next/server";
import { errorMessage, jsonError, tooLarge } from "@collectcollect/core/http";
import { applyImport, previewImport } from "@/lib/import";
import { createThrottle } from "@collectcollect/core/throttle";
import { CATEGORIES, type Category } from "@/lib/types";

const MAX_BYTES = 8 * 1024 * 1024;
/** How long an applied file is remembered, so the same one is not taken twice. */
const REPEAT_WINDOW_MS = 10 * 60_000;
const REMEMBERED = 100;

/** A preview and an apply per file, each through the parser; thirty a minute is a person, more is a loop. */
export const throttle = createThrottle(30, 60_000, "imports");

/** Token -> when it was applied. On the global object, so a development reload does not forget. */
const globalForImports = globalThis as unknown as { __skinsImports?: Map<string, number> };
function recentlyApplied(): Map<string, number> {
  return (globalForImports.__skinsImports ??= new Map());
}

function remember(recent: Map<string, number>, token: string): void {
  const now = Date.now();
  for (const [key, at] of recent) if (now - at >= REPEAT_WINDOW_MS) recent.delete(key);
  recent.set(token, now);
  // Oldest first, so the map never grows past what a busy afternoon needs.
  while (recent.size > REMEMBERED) {
    const oldest = recent.keys().next().value;
    if (oldest === undefined) break;
    recent.delete(oldest);
  }
}

/** For tests: forget every applied file. */
export function forgetAppliedImports(): void {
  recentlyApplied().clear();
}

/**
 * POST — read a CSV of items. Without `apply` it only reports what it found, so
 * the owner can check the column mapping before anything is written.
 */
export async function POST(request: Request) {
  // The CSV travels inside a JSON string, which can double its size; the
  // declared length is checked against that before the body is read.
  const refused = throttle.check(request) ?? tooLarge(request, MAX_BYTES * 2 + 1024, "That file is larger than 8 MB");
  if (refused) return refused;
  let body: { csv?: unknown; category?: unknown; apply?: unknown; token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Expected a JSON body");
  }
  if (typeof body.csv !== "string" || !body.csv.trim()) return jsonError("No CSV content");
  if (body.csv.length > MAX_BYTES) return jsonError("That file is larger than 8 MB", 413);

  // Object.hasOwn, not `in`: "constructor" is on every object's prototype.
  const category =
    typeof body.category === "string" && Object.hasOwn(CATEGORIES, body.category) ? (body.category as Category) : undefined;
  try {
    const preview = previewImport(body.csv, { category });
    const recent = recentlyApplied();
    if (!body.apply) {
      // Looking at the file again is how a second import of it is meant: the
      // owner has seen what it will do and asked for it. That lifts the guard
      // below for this file.
      recent.delete(preview.token);
      return NextResponse.json({ preview });
    }
    // What goes in has to be what was previewed: the token is the file and the
    // choices made about it, so a file edited after the preview is read again
    // first rather than imported as something the owner never saw.
    if (body.token !== preview.token) return jsonError("The file changed since it was previewed; read it again first", 409);
    // And an apply that arrives again without a fresh preview — a double
    // click, a retried request — is refused for a few minutes. A second copy
    // of every stack is the one thing an import must never quietly do.
    const appliedAt = recent.get(preview.token);
    if (appliedAt !== undefined && Date.now() - appliedAt < REPEAT_WINDOW_MS) {
      return jsonError("That file was imported a moment ago. Read it again first if you mean to import it twice.", 409);
    }
    const result = applyImport(preview);
    remember(recent, preview.token);
    return NextResponse.json({ preview, result });
  } catch (e) {
    return jsonError(`Could not read that file: ${errorMessage(e)}`, 400);
  }
}
