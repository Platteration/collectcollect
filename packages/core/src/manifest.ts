import type { MetadataRoute } from "next";

export interface ManifestSpec {
  name: string;
  shortName: string;
  description: string;
  /** The app's own dark ground, which the splash screen and the browser chrome match. */
  color: string;
  categories: string[];
  shortcuts: Array<{ name: string; shortName: string; url: string }>;
}

/**
 * What makes an app installable on a phone or desktop, opening without browser
 * chrome. The icons are the same four files in every app's `public/icons`,
 * rendered from its own SVG; everything else is the app's to say.
 */
export function buildManifest(spec: ManifestSpec): MetadataRoute.Manifest {
  return {
    name: spec.name,
    short_name: spec.shortName,
    description: spec.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: spec.color,
    theme_color: spec.color,
    categories: spec.categories,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: spec.shortcuts.map((s) => ({ name: s.name, short_name: s.shortName, url: s.url })),
  };
}
