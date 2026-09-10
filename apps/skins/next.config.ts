import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external to the server bundle. There is no sharp
  // here: skin images are Steam CDN URLs, so nothing is ever re-encoded.
  serverExternalPackages: ["better-sqlite3"],
  // The shared package ships TypeScript source rather than a build step.
  transpilePackages: ["@collectcollect/core"],
  // This app is one workspace among several, so dependency tracing has to start
  // at the repository root; left to itself Next would guess, and warn about it.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Steam serves every item image, and only Steam.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "community.cloudflare.steamstatic.com" },
      { protocol: "https", hostname: "steamcommunity-a.akamaihd.net" },
    ],
  },
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" as const } : {}),
};

export default nextConfig;
