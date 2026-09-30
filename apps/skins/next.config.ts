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
  // Item images are plain <img> tags pointing at Steam's CDN; nothing goes
  // through next/image, and the hosts allowed are named in the content
  // security policy the proxy sets.
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" as const } : {}),
  // The proxy's matcher leaves /_next/ alone, so its headers stop at the page.
  // These five are the ones that apply to a static file; the content security
  // policy needs the request's nonce and HSTS the request's scheme, and a
  // browser already holds both from the page that asked for the file. Kept
  // equal to securityHeaders() in packages/core/src/proxy.ts by
  // tests/next-config.test.ts, since this file cannot import it.
  async headers() {
    return [
      {
        source: "/_next/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
