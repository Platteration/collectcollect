#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Scaffold a new collection app on the shared engine.
 *
 *   node packages/create-domain/index.mjs <id> --name "Retro games" --singular game --plural games [--prefix RETRO_GAMES] [--port 3002] [--accent "#b45309"] [--light "#f6f5f2"] [--dark "#08090a"]
 *
 * Copies the template into apps/<id> with the placeholders filled in. The
 * result runs as-is with a starter spec; the domain's own fields, providers,
 * identification prompt and seed data go into src/lib/spec.ts.
 */

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error("Usage: create-domain <id> --name <Name> --singular <noun> --plural <nouns> [--prefix PREFIX] [--port 3002] [--accent #hex]");
  process.exit(1);
}
const name = opt("name", id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()));
const singular = opt("singular", "item");
const plural = opt("plural", `${singular}s`);
const prefix = opt("prefix", id.toUpperCase().replace(/-/g, "_"));
const port = opt("port", "3002");
const accent = opt("accent", "#b45309");
const light = opt("light", "#f6f5f2");
const dark = opt("dark", "#08090a");
const typeName = name.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase());

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const template = path.join(here, "template");
const target = path.join(root, "apps", id);
if (fs.existsSync(target)) {
  console.error(`${path.relative(root, target)} already exists`);
  process.exit(1);
}

const fill = (text) =>
  text
    .replaceAll("__ID__", id)
    .replaceAll("__NAME__", name)
    .replaceAll("__SINGULAR__", singular)
    .replaceAll("__PLURAL__", plural)
    .replaceAll("__PREFIX__", prefix)
    .replaceAll("__PORT__", port)
    .replaceAll("__ACCENT__", accent)
    .replaceAll("__BG_LIGHT__", light)
    .replaceAll("__BG_DARK__", dark)
    .replaceAll("__TYPE__", typeName);

let files = 0;
const walk = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, fill(entry.name));
    if (entry.isDirectory()) walk(src, dst);
    else {
      fs.writeFileSync(dst, fill(fs.readFileSync(src, "utf8")));
      files++;
    }
  }
};
walk(template, target);
console.log(`Created apps/${id} (${files} files).`);
console.log(`Next: describe the domain in apps/${id}/src/lib/spec.ts, then\n  npm install\n  npm run dev -w @collectcollect/${id}`);
