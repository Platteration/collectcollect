import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // The shared package ships TypeScript source rather than a build step.
  transpilePackages: ["@collectcollect/core"],
  // This app is one workspace among several, so dependency tracing has to start
  // at the repository root; left to itself Next would guess, and warn about it.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" as const } : {}),
};

export default nextConfig;
