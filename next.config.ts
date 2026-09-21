import type { NextConfig } from "next";
import { MAX_REQUEST_SIZE } from "./src/lib/limits";

/**
 * Deliberately no `headers()` here.
 *
 * `headers()` is evaluated once during `next build` and written into
 * `.next/routes-manifest.json`; the production server serves the manifest and
 * never consults this file for them again. Security headers that depend on
 * how the deployment is run — HSTS reads `APP_BASE_URL`, which the Docker
 * image only sees at `docker compose up` — would therefore have carried the
 * build machine's environment, and a copy here beside the proxy's would be
 * sent twice. They are emitted per request from `src/proxy.ts` instead; the
 * policy itself lives in `src/lib/security-headers.ts`.
 */
const nextConfig: NextConfig = {
  // Nothing gains from telling every client which framework and version this is.
  poweredByHeader: false,
  // Native modules must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  experimental: {
    // src/proxy.ts makes Next buffer a copy of every request body, and past
    // this it truncates the body silently instead of refusing the request. It
    // is therefore the real ceiling on every route, so it is set from the same
    // constant the routes enforce.
    proxyClientMaxBodySize: MAX_REQUEST_SIZE,
  },
  // Standalone output is for the Docker image only: it produces a
  // self-contained server.js, but `next start` does not support it, so a
  // normal local build keeps the default output.
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" as const } : {}),
};

export default nextConfig;
