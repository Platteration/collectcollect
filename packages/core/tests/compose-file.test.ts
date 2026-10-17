import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * compose.yaml: six services that carry the same settings, bound to this
 * machine, that start with no .env at all. Read as text, which needs nothing
 * installed, and then through `docker compose config`, which needs only the
 * Docker CLI (no daemon) and is left out where there is none.
 */
const repo = path.resolve(import.meta.dirname, "../../..");
const text = fs.readFileSync(path.join(repo, "compose.yaml"), "utf8");

const SERVICES = [
  { name: "cards", dataVar: "DATA_DIR", port: 3000 },
  { name: "skins", dataVar: "SKINS_DATA_DIR", port: 3001 },
  { name: "retro-games", dataVar: "RETRO_GAMES_DATA_DIR", port: 3002 },
  { name: "comics", dataVar: "COMICS_DATA_DIR", port: 3003 },
  { name: "watches", dataVar: "WATCHES_DATA_DIR", port: 3004 },
  { name: "whisky", dataVar: "WHISKY_DATA_DIR", port: 3005 },
] as const;

/** The lines of each service, between its heading and the next. */
function blocks(): Map<string, string> {
  const services = text.slice(text.indexOf("\nservices:\n"), text.indexOf("\nvolumes:\n"));
  const found = new Map<string, string>();
  const parts = services.split(/^ {2}([a-z-]+):\n/m);
  for (let i = 1; i < parts.length; i += 2) found.set(parts[i]!, parts[i + 1]!);
  return found;
}

describe("compose.yaml, read as text", () => {
  const all = blocks();

  it("has the six services and no other", () => {
    expect([...all.keys()]).toEqual(SERVICES.map((s) => s.name));
  });

  for (const { name, dataVar, port } of SERVICES) {
    describe(name, () => {
      const block = all.get(name) ?? "";
      it("is bound to this machine, on its own port", () => {
        expect(block).toContain(`- "127.0.0.1:${port}:3000"`);
      });
      it("starts without a .env", () => {
        expect(block).toMatch(/env_file:\n {6}- path: \.env\n {8}required: false\n/);
      });
      it("keeps its data in the volume, whatever .env says", () => {
        expect(block).toMatch(new RegExp(`\\n {4}environment:\\n(?: {6}.*\\n)*? {6}${dataVar}: /data\\n`));
      });
      it("has the health check, the longer stop, no capabilities and a memory limit", () => {
        expect(block).toContain("http://127.0.0.1:3000/api/health");
        expect(block).toContain("stop_grace_period: 30s");
        expect(block).toMatch(/security_opt:\n {6}- no-new-privileges:true\n/);
        expect(block).toMatch(/cap_drop:\n {6}- ALL\n/);
        expect(block).toContain("mem_limit: 2g");
        expect(block).toContain("restart: unless-stopped");
      });
    });
  }
});

const probe = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
const hasCompose = !probe.error && probe.status === 0;

interface Service {
  environment?: Record<string, string>;
  healthcheck?: unknown;
  stop_grace_period?: string;
  security_opt?: string[];
  cap_drop?: string[];
  mem_limit?: number | string;
  ports?: Array<{ host_ip?: string; published: string; target: number }>;
}

let scratch: string | null = null;
afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

/** `docker compose config` in a scratch directory holding compose.yaml and whatever else is given. */
function config(files: Record<string, string>, args: string[] = []) {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-compose-"));
  fs.copyFileSync(path.join(repo, "compose.yaml"), path.join(scratch, "compose.yaml"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(scratch, name), body);
  return spawnSync("docker", ["compose", "config", ...args], { cwd: scratch, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: scratch } });
}

describe.skipIf(!hasCompose)("compose.yaml, read by docker compose", () => {
  it("is valid with no .env at all, and with an empty one", () => {
    expect(config({}, ["-q"]).status).toBe(0);
    expect(config({ ".env": "" }, ["-q"]).status).toBe(0);
  });

  it("puts each app's data in /data even when .env points its data directory somewhere else", () => {
    const env = [...SERVICES.map((s) => `${s.dataVar}=./elsewhere`), "DATABASE_FILE=./elsewhere/x.db"].join("\n") + "\n";
    const r = config({ ".env": env }, ["--format", "json"]);
    expect(r.status).toBe(0);
    const services = (JSON.parse(r.stdout) as { services: Record<string, Service> }).services;
    for (const { name, dataVar } of SERVICES) {
      expect(services[name]?.environment?.[dataVar], `${name} ${dataVar}`).toBe("/data");
    }
  });

  it("gives all six the same hardening, and binds each to localhost on its own port", () => {
    const r = config({}, ["--format", "json"]);
    const services = (JSON.parse(r.stdout) as { services: Record<string, Service> }).services;
    for (const { name, port } of SERVICES) {
      const s = services[name]!;
      expect(s.healthcheck, name).toBeTruthy();
      expect(s.stop_grace_period, name).toBe("30s");
      expect(s.security_opt, name).toEqual(["no-new-privileges:true"]);
      expect(s.cap_drop, name).toEqual(["ALL"]);
      expect(Number(s.mem_limit), name).toBe(2 * 1024 ** 3);
      expect(s.ports, name).toEqual([expect.objectContaining({ host_ip: "127.0.0.1", published: String(port), target: 3000 })]);
    }
  });

  it("is published on every interface for exactly the apps an override names, with one binding each", () => {
    const override = ['services:', "  cards:", "    ports: !override", '      - "3000:3000"', "  whisky:", "    ports: !override", '      - "3005:3000"', ""].join("\n");
    const r = config({ "compose.override.yaml": override }, ["--format", "json"]);
    expect(r.status).toBe(0);
    const services = (JSON.parse(r.stdout) as { services: Record<string, Service> }).services;
    for (const { name, port } of SERVICES) {
      const ports = services[name]!.ports!;
      expect(ports, name).toHaveLength(1);
      expect(ports[0]!.published).toBe(String(port));
      if (name === "cards" || name === "whisky") expect(ports[0]!.host_ip, name).toBeUndefined();
      else expect(ports[0]!.host_ip, name).toBe("127.0.0.1");
    }
  });
});
