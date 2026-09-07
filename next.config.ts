import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // Standalone output is for the Docker image only: it produces a
  // self-contained server.js, but `next start` does not support it, so a
  // normal local build keeps the default output.
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" as const } : {}),
};

export default nextConfig;
