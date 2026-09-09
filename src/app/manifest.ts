import type { MetadataRoute } from "next";

/** Makes the app installable on a phone or desktop, opening without browser chrome. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CollectCollect",
    short_name: "Collect",
    description: "Photograph, identify, and price your trading cards.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#08090a",
    theme_color: "#08090a",
    categories: ["productivity", "finance", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Scan a stack", short_name: "Scan", url: "/scan" },
      { name: "Add a card", short_name: "Add", url: "/add" },
      { name: "Collection", short_name: "Collection", url: "/collection" },
    ],
  };
}
