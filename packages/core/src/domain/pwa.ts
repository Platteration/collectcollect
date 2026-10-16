import type { MetadataRoute } from "next";
import { buildVersion } from "../build-id";
import { guardResponse } from "../guard";
import { buildManifest } from "../manifest";
import { serviceWorkerResponse } from "../service-worker";
import { appTitle, type DomainSpec } from "./spec";

/**
 * What makes a domain app installable on a phone and gives it the safety net
 * the card and skins apps have: its web manifest, its service worker and its
 * `/guard.js`, each written once here from the app's spec. An app's route
 * files call these, one line each, because Next wants the files themselves in
 * the app's own `src/app`:
 *
 *   manifest.ts        domainManifest(spec)
 *   sw.js/route.ts     domainServiceWorkerResponse(spec)
 *   guard.js/route.ts  domainGuardResponse(spec)
 *
 * The icons are the app's own files in `public/icons` and `public/favicon.ico`,
 * rendered from its `scripts/icon.svg` by `npm run icons`.
 */
type Spec = Pick<DomainSpec, "id" | "name" | "description" | "noun" | "theme">;

/**
 * The web manifest. The splash screen and the browser's chrome take the spec's
 * dark ground, and the maskable icon is drawn on it too (scripts/icons.mjs),
 * so an installed app opens from its icon into a screen of the same colour.
 */
export function domainManifest(spec: Spec): MetadataRoute.Manifest {
  return buildManifest({
    name: appTitle(spec),
    shortName: spec.name,
    description: spec.description,
    color: spec.theme.dark,
    categories: ["productivity", "finance"],
    // The standard pages every domain app has; the app's own pages are in its nav.
    shortcuts: [
      { name: `Add a ${spec.noun.singular}`, shortName: "Add", url: "/add" },
      { name: "Collection", shortName: "Collection", url: "/collection" },
      { name: "Alerts", shortName: "Alerts", url: "/alerts" },
    ],
  });
}

/** The worker, with caches named for this app (the id is a slug, which a cache prefix allows) and this build's id as their version. */
export function domainServiceWorkerResponse(spec: Pick<Spec, "id">): Response {
  return serviceWorkerResponse(`collectcollect-${spec.id}`, buildVersion());
}

/**
 * The name the safety net's note carries. `guardSource` puts it inside a
 * string literal in a script, so it accepts letters, digits, spaces and a
 * middle dot and throws on anything else, and a throwing `/guard.js` would
 * leave every page of the app without a net. An app named "Hot-wheels" or
 * "Lego (sets)" is therefore written with spaces where the others were.
 */
export function guardName(spec: Pick<Spec, "name">): string {
  return appTitle(spec).replace(/[^A-Za-z0-9 ·]+/g, " ").replace(/ +/g, " ").trim().slice(0, 40).trim();
}

export function domainGuardResponse(spec: Pick<Spec, "name">): Response {
  return guardResponse(guardName(spec));
}
