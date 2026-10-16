import path from "node:path";
import type { NextConfig } from "next";
// Relative, not the package name: Next loads this file itself, before any
// transpilePackages rule applies to the shared package.
import { MAX_REQUEST_SIZE } from "../../packages/core/src/limits";

const nextConfig: NextConfig = {
  // Nothing gains from telling every client which framework this is.
  poweredByHeader: false,
  experimental: {
    // The proxy makes Next buffer a copy of every request body, and past this it
    // truncates the body silently instead of refusing the request: a backup
    // over 10 MB, Next's default, arrived cut short and its restore failed. It
    // is therefore the real ceiling on every route, so it is set from the same
    // constant the routes enforce (packages/core/src/limits.ts).
    proxyClientMaxBodySize: MAX_REQUEST_SIZE,
  },
  // Next answers an address with a trailing slash with a redirect of its own,
  // made before the proxy runs and so carrying none of its headers. The proxy
  // makes the same redirect instead (packages/core/src/proxy.ts).
  skipTrailingSlashRedirect: true,
  // Native modules must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // The shared package ships TypeScript source rather than a build step.
  transpilePackages: ["@collectcollect/core"],
  // This app is one workspace among several, so dependency tracing has to start
  // at the repository root; left to itself Next would guess, and warn about it.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Standalone output is for the Docker image only.
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" as const } : {}),
  // No headers() here: the proxy runs for every path and sets every security
  // header per request, which a header frozen into the build could only contradict.
};

export default nextConfig;
