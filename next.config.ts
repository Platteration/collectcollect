import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";

/**
 * A backstop for anything that slips past React's escaping, and for the
 * third-party URLs the app renders (card art and price-source links, which are
 * checked but come from outside).
 *
 * `'unsafe-inline'` for scripts is Next's inline bootstrap: a nonce would need
 * every page to be rendered per request. Images allow any https host plus the
 * blob: URLs the capture screens make for a photo that has not been uploaded
 * yet; `mediastream:` is the camera preview. `next dev` needs eval and its own
 * websocket, neither of which is in a built app.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' blob: mediastream:",
  "font-src 'self'",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Native modules must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // Standalone output is for the Docker image only: it produces a
  // self-contained server.js, but `next start` does not support it, so a
  // normal local build keeps the default output.
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" as const } : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          // frame-ancestors covers this for current browsers; the old header
          // costs nothing and still means something to the older ones.
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
