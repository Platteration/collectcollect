import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The same rules the apps run, so a component that moves between an app and
// this package does not change what is allowed.
const eslintConfig = defineConfig([...nextVitals, ...nextTs, globalIgnores(["node_modules/**"])]);

export default eslintConfig;
