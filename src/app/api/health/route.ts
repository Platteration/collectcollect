// The version comes from package.json rather than npm_package_version: under
// `next start` in the Docker image nothing sets that variable.
import pkg from "../../../../package.json";

/**
 * Liveness for a container check: `{ ok, version }` and nothing more. The
 * proxy answers this path without a session and whatever ALLOWED_HOSTS names,
 * so it must never carry anything a stranger or a rebound page could use —
 * no data directory, no environment, no counts from the collection.
 */
export function GET() {
  return Response.json({ ok: true, version: pkg.version });
}
