import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp"],
};

export default nextConfig;
