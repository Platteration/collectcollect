import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The same rules the apps run under: this package is their source, shipped
// as TypeScript, and a mistake here reaches both of them. The one rule that
// wants an app directory to look at is switched off, since there is none here.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
]);
