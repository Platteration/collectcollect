/**
 * Render this app's icons from scripts/icon.svg:
 *
 *   npm run icons -w @collectcollect/watches
 *
 * What it writes, and why the files are committed, is in scripts/render-icons.mjs
 * at the repository root. The ground is spec.theme.dark in src/lib/spec.ts, the
 * colour the web manifest gives the splash screen; tests/installable.test.ts
 * holds the maskable icon to it.
 */
import path from "node:path";
import { writeIcons } from "../../../scripts/render-icons.mjs";

await writeIcons({
  svgPath: path.join(import.meta.dirname, "icon.svg"),
  ground: "#08110f",
  publicDir: path.join(import.meta.dirname, "..", "public"),
});
