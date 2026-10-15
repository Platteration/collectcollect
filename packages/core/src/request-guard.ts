import { isSecureRequest } from "./net";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PRIVATE_SUFFIXES = [".localhost", ".local", ".lan", ".internal", ".home.arpa"];
const MULTIPART_PATHS = new Set(["/api/uploads", "/api/backup/restore", "/api/collection/import"]);

/** Parse an authority strictly; credentials, paths and ambiguous ports are never hosts. */
function authority(value: string): URL | null {
  try {
    const url = new URL(`http://${value}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

/** A public DNS name needs the operator's explicit approval to prevent rebinding. */
export function hostAllowed(value: string, configured = process.env.ALLOWED_HOSTS): boolean {
  const url = authority(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // Loopback health checks and LAN access still work when public proxy names are configured.
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return true;
  if (!host.includes(".") || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (configured?.trim()) {
    return configured.split(",").some((entry) => authority(entry.trim())?.hostname.toLowerCase().replace(/\.$/, "") === host);
  }
  return false;
}

/** Browser provenance is checked even when the optional password is disabled. */
export function requestSecurityError(request: Request): { status: number; message: string } | null {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const parsed = authority(host);
  if (!parsed || !hostAllowed(host)) {
    return { status: 403, message: "This server does not answer to that host name. Set ALLOWED_HOSTS to add it." };
  }
  if (READ_METHODS.has(request.method.toUpperCase())) return null;

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return { status: 403, message: "Cross-site request refused." };
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const expected = new URL(`${isSecureRequest(request) ? "https:" : "http:"}//${host}`).origin;
      if (new URL(origin).origin !== expected || origin === "null") throw new Error("Different origin");
    } catch {
      return { status: 403, message: "Cross-site request refused." };
    }
  }

  // No JSON handler accepts a safelisted text/plain form, even if its bytes parse as JSON.
  // Multipart upload/restore routes retain their existing size and archive validation.
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/") && request.body && !MULTIPART_PATHS.has(path)) {
    const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return { status: 415, message: "Expected application/json" };
  }
  return null;
}
