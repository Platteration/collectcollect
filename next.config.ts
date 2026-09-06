import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // Self-contained server output for the Docker image (npm start still works).
  output: "standalone",
};

export default nextConfig;
