import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The scaffolder and the template it copies, under the rules the apps run:
// a mistake in the template is a mistake in every app made from it. ESLint
// reads one config, this one, so the template's own (which a scaffolded app
// uses) is not read here; the rule that wants an app directory is pointed at
// the template's.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: "template/" } } },
  globalIgnores(["template/.next/**", "template/next-env.d.ts"]),
]);
