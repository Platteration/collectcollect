import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * scripts/install.sh, run in a scratch copy of the repository with a fake
 * `docker`, `curl` and network tools first on PATH: no daemon, no network, no
 * build. What is checked is what the script does with them: the files it
 * writes, the commands it gives docker, and what it tells the owner.
 */
const repo = path.resolve(import.meta.dirname, "../../..");
const APPS = ["cards", "skins", "retro-games", "comics", "watches", "whisky"] as const;
const PORTS: Record<(typeof APPS)[number], number> = { cards: 3000, skins: 3001, "retro-games": 3002, comics: 3003, watches: 3004, whisky: 3005 };
const PREFIX: Record<(typeof APPS)[number], string> = { cards: "", skins: "SKINS_", "retro-games": "RETRO_GAMES_", comics: "COMICS_", watches: "WATCHES_", whisky: "WHISKY_" };
const passwordVar = (app: (typeof APPS)[number]) => `${PREFIX[app]}APP_PASSWORD`;
const secretVar = (app: (typeof APPS)[number]) => `${PREFIX[app]}APP_SECRET`;

const posix = process.platform !== "win32";
const maybe = posix ? describe : describe.skip;

let work: string;
let bin: string;
let tools: string;
let log: string;

/**
 * The ordinary tools the script uses, linked into one directory, and nothing
 * else: no real docker, curl or network tool can be reached from PATH, so a
 * test cannot start a container or read the machine's own address by accident.
 */
const NEEDED = ["bash", "awk", "cat", "chmod", "cut", "dirname", "grep", "head", "mktemp", "mv", "od", "openssl", "rm", "sed", "sleep", "tail", "tr", "wc", "cp", "ls", "date"];
function findTool(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* not in this directory */
    }
  }
  return null;
}
const BASH = findTool("bash") ?? "bash";
// The one thing a test may ask the real Docker CLI: to read the files (`compose config`), which needs no daemon.
const REAL_DOCKER = findTool("docker");
const realCompose = REAL_DOCKER !== null && spawnSync(REAL_DOCKER, ["compose", "version"], { encoding: "utf8" }).status === 0;

/** A script file in the fake bin directory. */
function fake(name: string, body: string) {
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-install-"));
  bin = path.join(work, "fake-bin");
  tools = path.join(work, "tools");
  log = path.join(work, "calls.log");
  fs.mkdirSync(bin);
  fs.mkdirSync(tools);
  for (const name of NEEDED) {
    const found = findTool(name);
    if (found) fs.symlinkSync(found, path.join(tools, name));
  }
  fs.mkdirSync(path.join(work, "scripts"));
  fs.writeFileSync(path.join(work, "calls.log"), "");
  fs.copyFileSync(path.join(repo, "scripts/install.sh"), path.join(work, "scripts/install.sh"));
  fs.chmodSync(path.join(work, "scripts/install.sh"), 0o755);
  fs.copyFileSync(path.join(repo, ".env.example"), path.join(work, ".env.example"));
  fs.copyFileSync(path.join(repo, "compose.yaml"), path.join(work, "compose.yaml"));

  // Docker with a Compose plugin and a daemon; `up` and `config` are told what to do by the environment.
  fake(
    "docker",
    `
echo "docker $*" >> "$FAKE_LOG"
case "$1 $2" in
  "compose version") echo "Docker Compose version v2.99.0"; exit 0 ;;
  "compose config")
    if [ -n "\${FAKE_COMPOSE_BROKEN:-}" ]; then echo "validating compose.yaml: services.cards.ports is invalid" >&2; exit 1; fi
    if [ -n "\${FAKE_COMPOSE_REJECTS_OVERRIDE:-}" ] && grep -q '!override' compose.override.yaml 2>/dev/null; then
      echo "yaml: unknown tag !override" >&2; exit 15
    fi
    exit 0 ;;
  "compose up")
    for f in .env compose.override.yaml; do [ -e "$f" ] && echo "  at up: $f exists" >> "$FAKE_LOG"; done
    if [ "\${FAKE_UP_EXIT:-0}" != 0 ]; then echo "npm error Missing: @next/env@16.3.4 from lock file" >&2; exit "$FAKE_UP_EXIT"; fi
    exit 0 ;;
esac
case "$1" in info) exit 0 ;; esac
exit 0`,
  );
  // curl answers every health route except the ports listed in FAKE_CURL_DOWN.
  fake(
    "curl",
    `
echo "curl $*" >> "$FAKE_LOG"
url="\${@: -1}"
port="\${url##*:}"; port="\${port%%/*}"
case ",\${FAKE_CURL_DOWN:-}," in *",$port,"*) exit 22 ;; esac
exit 0`,
  );
  // The tools the LAN address comes from: one address by default.
  fake("ip", `[ -n "\${FAKE_IP_SRC-192.168.1.20}" ] && echo "1.1.1.1 via 192.168.1.1 dev wlan0 src \${FAKE_IP_SRC-192.168.1.20} uid 1000"; exit 0`);
  fake("hostname", `echo "\${FAKE_HOSTNAME_I:-}"`);
  fake("route", "exit 1");
  fake("ipconfig", "exit 1");
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

interface Result {
  code: number | null;
  out: string;
  err: string;
  all: string;
}

function envFor(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: `${bin}:${tools}`,
    HOME: work,
    LANG: "C",
    FAKE_LOG: log,
    INSTALL_HEALTH_TIMEOUT: "3",
    INSTALL_HEALTH_INTERVAL: "1",
    ...extra,
  };
}

function run(args: string[] = [], extra: Record<string, string> = {}): Result {
  const r = spawnSync(BASH, ["scripts/install.sh", ...args], { cwd: work, env: envFor(extra), encoding: "utf8", timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

const calls = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
const upCalls = () => calls().filter((c) => c.startsWith("docker compose up"));
const envText = () => fs.readFileSync(path.join(work, ".env"), "utf8");
const exists = (name: string) => fs.existsSync(path.join(work, name));
const leftovers = () => fs.readdirSync(work).filter((n) => /\.tmp\./.test(n));
const sha = (name: string) => crypto.createHash("sha256").update(fs.readFileSync(path.join(work, name))).digest("hex");

/** NAME=value for the last uncommented assignment, as the installer reads it. */
function valueOf(text: string, name: string): string | undefined {
  let found: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const m = new RegExp(`^${name}=(.*)$`).exec(line);
    if (m) found = m[1];
  }
  return found;
}

maybe("scripts/install.sh: a first install", () => {
  it("writes a private .env with a password and a secret for every app, and starts only cards", () => {
    const r = run();
    expect(r.code).toBe(0);

    const env = envText();
    const passwords = new Set<string>();
    for (const app of APPS) {
      expect(valueOf(env, passwordVar(app)), passwordVar(app)).toMatch(/^[0-9a-f]{24}$/);
      expect(valueOf(env, secretVar(app)), secretVar(app)).toMatch(/^[0-9a-f]{64}$/);
      passwords.add(valueOf(env, passwordVar(app))!);
    }
    expect(passwords.size).toBe(APPS.length);
    expect(fs.statSync(path.join(work, ".env")).mode & 0o777).toBe(0o600);
    expect(leftovers()).toEqual([]);
    expect(exists("compose.override.yaml")).toBe(false);

    // Twelve lines differ from the template and nothing else does.
    const template = fs.readFileSync(path.join(work, ".env.example"), "utf8").split("\n");
    const written = env.split("\n");
    expect(written.length).toBe(template.length);
    const changed = written.filter((line, i) => line !== template[i]);
    expect(changed.map((l) => l.split("=")[0]).sort()).toEqual(APPS.flatMap((a) => [passwordVar(a), secretVar(a)]).sort());

    // Cards only is started and asked about, on its own port, with bounded timeouts.
    expect(upCalls()).toEqual(["docker compose up -d --build cards"]);
    const asked = calls().filter((c) => c.startsWith("curl"));
    expect(asked.length).toBeGreaterThan(0);
    for (const c of asked) {
      expect(c).toContain("http://127.0.0.1:3000/api/health");
      expect(c).toMatch(/--connect-timeout \d/);
      expect(c).toMatch(/--max-time \d/);
    }

    // It shows the password it made for cards, and none of the others'.
    expect(r.out).toContain(valueOf(env, "APP_PASSWORD")!);
    expect(r.out).toContain("http://localhost:3000");
    expect(r.all).not.toContain(valueOf(env, "SKINS_APP_PASSWORD")!);
    expect(r.all).not.toMatch(/[0-9a-f]{64}/); // no secret is ever printed
    expect(r.out).not.toContain("http://192.168");
  });

  it("shows the password before it builds, so a failed build does not hide it", () => {
    const r = run([], { FAKE_UP_EXIT: "1" });
    expect(r.code).toBe(1);
    const password = valueOf(envText(), "APP_PASSWORD")!;
    expect(r.out).toContain(password);
    // And says where it is kept and what to do, in words.
    expect(r.err).toContain("could not build or start: cards");
    expect(r.err).toContain(path.join(work, ".env"));
    expect(r.err).toContain("APP_PASSWORD");
    expect(r.err).toContain("run this script again");
    expect(calls().filter((c) => c.startsWith("curl"))).toEqual([]);

    // The .env it left is whole, and the rerun after the fix keeps it byte for byte.
    const before = sha(".env");
    const again = run();
    expect(again.code).toBe(0);
    expect(sha(".env")).toBe(before);
  });

  it("keeps what it writes private even where mktemp makes files by the umask", () => {
    // BSD, GNU and Git Bash make their temporary files 0600; this one does not, so the script's own umask is what is left to do it.
    fake("mktemp", 'name="${1%XXXXXX}$(od -An -N3 -tx1 /dev/urandom | tr -d " \\n")"\n: > "$name"\necho "$name"');
    expect(run(["--lan"]).code).toBe(0);
    expect(fs.statSync(path.join(work, ".env")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(work, "compose.override.yaml")).mode & 0o777).toBe(0o600);
  });

  it("says .env is private only when it is, since Git Bash on Windows keeps no permission bits", () => {
    const real = run();
    expect(real.out).toContain("Created .env (readable by you only)");
    fs.rmSync(path.join(work, ".env"));
    fake("ls", 'echo "-rw-r--r-- 1 owner group 0 Jan  1 00:00 .env"');
    const open = run();
    expect(open.out).not.toContain("readable by you only");
    expect(open.out).toContain("keep the folder private");
  });

  it("reads a template that came out of Git for Windows with CRLF line endings", () => {
    const template = fs.readFileSync(path.join(work, ".env.example"), "utf8").replace(/\n/g, "\r\n");
    fs.writeFileSync(path.join(work, ".env.example"), template);
    expect(run().code).toBe(0);
    expect(envText()).not.toContain("\r");
    expect(valueOf(envText(), "APP_PASSWORD")).toMatch(/^[0-9a-f]{24}$/);
  });

  it("starts the apps it is told to, once each, in a fixed order", () => {
    expect(run(["whisky", "skins", "whisky"]).code).toBe(0);
    expect(upCalls()).toEqual(["docker compose up -d --build skins whisky"]);
    const ports = new Set(calls().filter((c) => c.startsWith("curl")).map((c) => /:(\d+)\/api\/health/.exec(c)![1]));
    expect([...ports].sort()).toEqual(["3001", "3005"]);
  });

  it("starts every app with --all, asks each one's own port, and shows all six passwords", () => {
    const r = run(["--all"]);
    expect(r.code).toBe(0);
    expect(upCalls()).toEqual([`docker compose up -d --build ${APPS.join(" ")}`]);
    const ports = new Set(calls().filter((c) => c.startsWith("curl")).map((c) => /:(\d+)\/api\/health/.exec(c)![1]));
    expect([...ports].sort()).toEqual(APPS.map((a) => String(PORTS[a])).sort());
    for (const app of APPS) {
      expect(r.out).toContain(valueOf(envText(), passwordVar(app))!);
      expect(r.out).toContain(`http://localhost:${PORTS[app]}`);
    }
  });

  it("refuses an app or an option it does not know, before touching anything", () => {
    for (const args of [["nonesuch"], ["--lan-ip"], ["cards", "-x"]]) {
      const r = run(args);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.err).toMatch(/unknown (app|option)/);
    }
    expect(exists(".env")).toBe(false);
    expect(calls().filter((c) => c.startsWith("docker compose up"))).toEqual([]);
  });

  it("prints its usage for --help without needing Docker", () => {
    fs.rmSync(path.join(bin, "docker"));
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("--lan");
    expect(r.out).toContain("--all");
    expect(exists(".env")).toBe(false);
  });

  it("fails clearly, before writing .env, when Docker is not there", () => {
    fs.rmSync(path.join(bin, "docker"));
    const r = run();
    expect(r.code).toBe(1);
    expect(r.err).toContain("Docker was not found on PATH");
    expect(exists(".env")).toBe(false);
  });

  it("fails clearly, before writing .env, when the daemon is not running", () => {
    fake("docker", 'case "$1 $2" in "compose version") exit 0 ;; esac\nexit 1');
    const r = run();
    expect(r.code).toBe(1);
    expect(r.err).toContain("the daemon is not reachable");
    expect(exists(".env")).toBe(false);
  });

  it("asks with wget, held to a few seconds and one try, when there is no curl", () => {
    fs.rmSync(path.join(bin, "curl"));
    fake("wget", 'echo "wget $*" >> "$FAKE_LOG"\ncase "$1" in --help) echo "      --tries=NUMBER"; exit 0 ;; esac\nexit 0');
    expect(run().code).toBe(0);
    const asked = calls().filter((c) => c.startsWith("wget ") && c.includes("/api/health"));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0]).toContain("-T 5");
    expect(asked[0]).toContain("--tries=1");
  });

  it("asks with a BusyBox wget, which has no --tries, without it", () => {
    fs.rmSync(path.join(bin, "curl"));
    fake("wget", 'echo "wget $*" >> "$FAKE_LOG"\ncase "$1" in --help) echo "BusyBox wget [-T SEC]"; exit 0 ;; esac\nexit 0');
    expect(run().code).toBe(0);
    const asked = calls().filter((c) => c.startsWith("wget ") && c.includes("/api/health"));
    expect(asked[0]).toContain("-T 5");
    expect(asked[0]).not.toContain("--tries");
  });

  it("stops, saying what to install, when it has neither curl nor wget", () => {
    fs.rmSync(path.join(bin, "curl"));
    const r = run();
    expect(r.code).toBe(1);
    expect(r.err).toContain("curl or wget is required");
  });

  it("stops, starting nothing, when Compose cannot read the files, and shows Compose's own words", () => {
    const r = run([], { FAKE_COMPOSE_BROKEN: "1" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("services.cards.ports is invalid");
    expect(r.err).toContain("Nothing was started");
    expect(upCalls()).toEqual([]);
    const lan = run(["--lan"], { FAKE_COMPOSE_BROKEN: "1" });
    expect(lan.code).toBe(1);
    expect(exists("compose.override.yaml")).toBe(false);
  });

  it("stops when the template is missing, before anything is written", () => {
    fs.rmSync(path.join(work, ".env.example"));
    const r = run();
    expect(r.code).toBe(1);
    expect(r.err).toContain(".env.example not found");
    expect(exists(".env")).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it("stops, writing nothing, when the random source gives something that is not hex", () => {
    fake("openssl", 'echo "not-hex"');
    const r = run();
    expect(r.code).toBe(1);
    expect(r.err).toContain("failed to generate APP_PASSWORD");
    expect(exists(".env")).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it("reads back what it wrote, and writes no .env when a value did not land", () => {
    // A rewrite that quietly drops every line it should have filled in.
    fake("awk", `if [ -n "\${CC_GENERATED:-}" ]; then cat > /dev/null; exit 0; fi\nPATH="${tools}" exec awk "$@"`);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.err).toContain("could not write APP_PASSWORD to .env; nothing was changed");
    expect(exists(".env")).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(upCalls()).toEqual([]);
  });

  it("says so, and exits non-zero, when an app never answers", () => {
    const r = run(["cards", "skins"], { FAKE_CURL_DOWN: "3001" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("not healthy within 3 seconds: skins");
    expect(r.err).toContain("docker compose logs -f skins");
    expect(r.err).toContain(path.join(work, ".env"));
  });
});

maybe("scripts/install.sh: a rerun", () => {
  it("leaves .env exactly as it was and says each chosen app asks for a login", () => {
    expect(run(["--all"]).code).toBe(0);
    const before = sha(".env");
    const r = run(["--all"]);
    expect(r.code).toBe(0);
    expect(sha(".env")).toBe(before);
    expect(r.out).toContain(".env already exists - not changed");
    for (const app of APPS) expect(r.out).toContain(`${app}: asks for a login (${passwordVar(app)} in .env)`);
    // Not repeated on the screen: it points at the file instead.
    for (const app of APPS) expect(r.all).not.toContain(valueOf(envText(), passwordVar(app))!);
    expect(r.out).toContain("grep _PASSWORD= .env");
  });

  it("names the chosen apps that have no password, whatever way the line is left empty", () => {
    const hex = "ab".repeat(32);
    fs.writeFileSync(
      path.join(work, ".env"),
      [
        "APP_PASSWORD=hunter2", // cards has one
        "# SKINS_APP_PASSWORD=commented", // commented out
        'RETRO_GAMES_APP_PASSWORD=""', // empty in quotes
        "COMICS_APP_PASSWORD=   ", // blanks only
        "WATCHES_APP_PASSWORD= # none yet", // a comment where the value goes
        "export WHISKY_APP_PASSWORD='quoted'", // present, quoted and exported
        `APP_SECRET=${hex}`,
        "",
      ].join("\n"),
    );
    const before = sha(".env");
    const r = run(["--all"]);
    expect(r.code).toBe(0); // on localhost, an app without a password is allowed; it is said, not refused
    expect(sha(".env")).toBe(before);
    expect(r.out).toContain("cards: asks for a login");
    expect(r.out).toContain("whisky: asks for a login");
    for (const app of ["skins", "retro-games", "comics", "watches"] as const) {
      expect(r.out).toContain(`${app}: NO PASSWORD - ${passwordVar(app)} is empty or missing in .env`);
    }
    // And offers a line to add, with a fresh value, that it does not write itself.
    expect(r.out).toMatch(/SKINS_APP_PASSWORD=[0-9a-f]{24}/);
    expect(valueOf(envText(), "SKINS_APP_PASSWORD")).toBeUndefined();
  });

  it("counts Google sign-in as a gate for the apps that have it, and for no others", () => {
    fs.writeFileSync(path.join(work, ".env"), "GOOGLE_ALLOWED_SUBS=1234\nSKINS_GOOGLE_CLIENT_ID=abc.apps.googleusercontent.com\nWATCHES_GOOGLE_CLIENT_ID=abc\n");
    const r = run(["cards", "skins", "watches"]);
    expect(r.out).toContain("cards: asks for a login");
    expect(r.out).toContain("skins: asks for a login");
    expect(r.out).toContain("watches: NO PASSWORD");
  });

  it("does not take the skins variables for the card app's", () => {
    fs.writeFileSync(path.join(work, ".env"), "SKINS_APP_PASSWORD=x\nSKINS_GOOGLE_CLIENT_ID=y\n");
    expect(run(["cards"]).out).toContain("cards: NO PASSWORD");
  });
});

maybe("scripts/install.sh: a write that is interrupted", () => {
  it("leaves no .env at all when the rewrite fails, so the rerun makes a complete one", () => {
    // Stands in for a full disk or a killed process: the step that fills in the passwords dies.
    fake("awk", `if [ -n "\${CC_GENERATED:-}" ]; then exit 2; fi\nPATH="${tools}" exec awk "$@"`);
    const r = run();
    expect(r.code).not.toBe(0);
    expect(exists(".env")).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(upCalls()).toEqual([]);

    fs.rmSync(path.join(bin, "awk"));
    const again = run();
    expect(again.code).toBe(0);
    expect(valueOf(envText(), "APP_PASSWORD")).toMatch(/^[0-9a-f]{24}$/);
    expect(again.out).toContain("Creating .env");
  });

  it("removes the half-written copy when stopped with Ctrl-C, and never makes it readable by others", async () => {
    fake("awk", `if [ -n "\${CC_GENERATED:-}" ]; then sleep 30; exit 2; fi\nPATH="${tools}" exec awk "$@"`);
    const child = spawn("bash", ["scripts/install.sh"], { cwd: work, env: envFor(), detached: true, stdio: "ignore" });
    const done = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    // Wait for the temporary file to exist: the script is now inside the write.
    const deadline = Date.now() + 15_000;
    while (leftovers().length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const temporary = leftovers();
    expect(temporary.length).toBe(1);
    expect(fs.statSync(path.join(work, temporary[0]!)).mode & 0o777).toBe(0o600);
    expect(exists(".env")).toBe(false);
    // What the terminal does on Ctrl-C: the signal goes to the whole group.
    process.kill(-child.pid!, "SIGINT");
    expect(await done).toBe(130);
    expect(leftovers()).toEqual([]);
    expect(exists(".env")).toBe(false);

    fs.rmSync(path.join(bin, "awk"));
    expect(run().code).toBe(0);
    expect(exists(".env")).toBe(true);
  });

  it("clears the copy a killed run left behind before it writes a new one", async () => {
    fake("awk", `if [ -n "\${CC_GENERATED:-}" ]; then sleep 30; exit 2; fi\nPATH="${tools}" exec awk "$@"`);
    const child = spawn("bash", ["scripts/install.sh"], { cwd: work, env: envFor(), detached: true, stdio: "ignore" });
    const done = new Promise<number | null>((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 137 : null))));
    const deadline = Date.now() + 15_000;
    while (leftovers().length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    process.kill(-child.pid!, "SIGKILL"); // no chance to clean up
    await done;
    expect(exists(".env")).toBe(false); // a kill never leaves a .env, only the temporary copy
    expect(leftovers().length).toBe(1);

    fs.rmSync(path.join(bin, "awk"));
    expect(run().code).toBe(0);
    expect(leftovers()).toEqual([]);
    expect(valueOf(envText(), "APP_PASSWORD")).toMatch(/^[0-9a-f]{24}$/);
  });

  it("does not replace a .env that appeared while it ran", () => {
    // The step that verifies the copy is the last before the move; make .env appear there.
    fake("awk", `if [ -z "\${CC_GENERATED:-}" ] && [ -n "\${1:-}" ] && [ "\${1}" = "-v" ] && [ ! -e .env ]; then echo "APP_PASSWORD=mine" > .env; fi\nPATH="${tools}" exec awk "$@"`);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.err).toContain("appeared while this script was running");
    expect(envText()).toBe("APP_PASSWORD=mine\n");
    expect(leftovers()).toEqual([]);
  });
});

maybe("scripts/install.sh --lan", () => {
  it("publishes the chosen apps on every interface, and only them, and prints the phone's addresses", () => {
    const r = run(["--lan", "cards", "whisky"]);
    expect(r.code).toBe(0);
    const override = fs.readFileSync(path.join(work, "compose.override.yaml"), "utf8");
    expect(override.split("\n")[0]).toBe("# Written by the CollectCollect installer (scripts/install.sh --lan or scripts/install.ps1 -Lan)");
    expect(override).toMatch(/\n {2}cards:\n {4}ports: !override\n {6}- "3000:3000"\n/);
    expect(override).toMatch(/\n {2}whisky:\n {4}ports: !override\n {6}- "3005:3000"\n/);
    expect(override).not.toMatch(/skins|retro-games|comics|watches/);
    expect(override).not.toContain("127.0.0.1");
    expect(fs.statSync(path.join(work, "compose.override.yaml")).mode & 0o077).toBe(0);
    // Written before docker is asked to start anything.
    expect(calls()).toContain("  at up: compose.override.yaml exists");
    expect(leftovers()).toEqual([]);

    expect(r.out).toContain("cards: http://192.168.1.20:3000");
    expect(r.out).toContain("whisky: http://192.168.1.20:3005");
    // What plain http cannot do on a phone, in the owner's words.
    expect(r.out).toMatch(/plain http/);
    expect(r.out).toMatch(/home screen/);
    expect(r.out).toMatch(/offline/);
    expect(r.out).toMatch(/live camera in cards' Scan/);
    expect(r.out).toContain("Phone access");
  });

  it("goes with every app that has a password, since a fresh .env gives all of them one", () => {
    const r = run(["--lan", "--all"]);
    expect(r.code).toBe(0);
    const override = fs.readFileSync(path.join(work, "compose.override.yaml"), "utf8");
    for (const app of APPS) expect(override).toContain(`"${PORTS[app]}:3000"`);
    for (const app of APPS) expect(r.out).toContain(`${app}: http://192.168.1.20:${PORTS[app]}`);
  });

  it("refuses to publish an app that has no password, and starts nothing", () => {
    fs.writeFileSync(path.join(work, ".env"), "APP_PASSWORD=hunter2\n");
    const before = sha(".env");
    const r = run(["--lan", "cards", "skins"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not publishing on your network: no password for skins");
    expect(exists("compose.override.yaml")).toBe(false);
    expect(upCalls()).toEqual([]);
    expect(sha(".env")).toBe(before);
    // With a password for every chosen app it goes ahead.
    fs.appendFileSync(path.join(work, ".env"), "SKINS_APP_PASSWORD=pw\n");
    expect(run(["--lan", "cards", "skins"]).code).toBe(0);
  });

  it("leaves a compose.override.yaml it did not write alone", () => {
    fs.writeFileSync(path.join(work, "compose.override.yaml"), "services: {}\n");
    const r = run(["--lan"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("was not written by this script");
    expect(fs.readFileSync(path.join(work, "compose.override.yaml"), "utf8")).toBe("services: {}\n");
    expect(upCalls()).toEqual([]);
    // And without --lan it says it is in effect rather than removing it.
    const plain = run();
    expect(plain.code).toBe(0);
    expect(plain.out).toContain("was not written by this script");
    expect(fs.readFileSync(path.join(work, "compose.override.yaml"), "utf8")).toBe("services: {}\n");
  });

  it("removes what it wrote when this Compose cannot read it, and starts nothing", () => {
    const r = run(["--lan"], { FAKE_COMPOSE_REJECTS_OVERRIDE: "1" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("2.24");
    expect(exists("compose.override.yaml")).toBe(false);
    expect(upCalls()).toEqual([]);
  });

  it("puts the apps back on localhost when it is run again without --lan", () => {
    expect(run(["--lan"]).code).toBe(0);
    expect(exists("compose.override.yaml")).toBe(true);
    const r = run();
    expect(r.code).toBe(0);
    expect(exists("compose.override.yaml")).toBe(false);
    expect(r.out).toContain("Removed compose.override.yaml");
    expect(r.out).not.toContain("192.168.1.20");
  });

  it("names the address it could not find rather than inventing one, and skips Docker's own bridge", () => {
    const none = run(["--lan"], { FAKE_IP_SRC: "", FAKE_HOSTNAME_I: "" });
    expect(none.code).toBe(0);
    expect(none.out).toContain("http://<this-computer-ip>:3000");
    expect(none.out).toContain("was not found");
    // Run again over the file the first run wrote: a script-written override is replaced.
    const several = run(["--lan"], { FAKE_IP_SRC: "", FAKE_HOSTNAME_I: "172.17.0.1 192.168.1.20 10.0.0.5 203.0.113.9" });
    expect(several.out).toContain("cards: http://192.168.1.20:3000");
    expect(several.out).toContain("other addresses too (10.0.0.5)");
    expect(several.out).not.toContain("172.17.0.1");
    expect(several.out).not.toContain("203.0.113.9");
  });

  it("asks Windows for the computer's address when it runs under Git Bash, and drops the carriage return", () => {
    fake("powershell.exe", `printf '192.168.0.7\\r\\n'`);
    const r = run(["--lan"]);
    expect(r.out).toContain("cards: http://192.168.0.7:3000");
    expect(calls().filter((c) => c.startsWith("docker compose up"))).toHaveLength(1);
  });

  it("finds the address of the default interface on a Mac, where there is no `ip`", () => {
    fs.rmSync(path.join(bin, "ip"));
    fake("route", 'echo "   route to: default"\necho "  interface: en0"');
    fake("ipconfig", '[ "$1 $2" = "getifaddr en0" ] && echo 192.168.1.30');
    const r = run(["--lan"]);
    expect(r.out).toContain("cards: http://192.168.1.30:3000");
  });

  it("warns when .env would make the apps turn the phone away", () => {
    expect(run(["--lan"]).code).toBe(0);
    fs.appendFileSync(path.join(work, ".env"), "ALLOWED_HOSTS=cards.example.com\nCOOKIE_SECURE=1\n");
    const r = run(["--lan"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ALLOWED_HOSTS in .env is 'cards.example.com', which does not list 192.168.1.20");
    expect(r.out).toContain("COOKIE_SECURE=1");
    fs.appendFileSync(path.join(work, ".env"), "ALLOWED_HOSTS=cards.example.com,192.168.1.20\nCOOKIE_SECURE=0\n");
    const fine = run(["--lan"]);
    expect(fine.out).not.toContain("Warning");
  });
});

maybe("scripts/install.sh --lan, read by the real docker compose", () => {
  /** What the real Compose makes of compose.yaml, .env and the override the installer left in the scratch copy. */
  function published() {
    const r = spawnSync(REAL_DOCKER!, ["compose", "config", "--format", "json"], { cwd: work, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: work } });
    expect(r.status, r.stderr).toBe(0);
    const services = (JSON.parse(r.stdout) as { services: Record<string, { ports: Array<{ host_ip?: string; published: string }> }> }).services;
    return Object.fromEntries(APPS.map((a) => [a, services[a]!.ports.map((p) => `${p.host_ip ?? "*"}:${p.published}`)]));
  }

  it.skipIf(!realCompose)("binds the chosen apps to every interface, once each, and the rest to localhost", () => {
    expect(run(["--lan", "skins", "comics"]).code).toBe(0);
    expect(published()).toEqual({
      cards: ["127.0.0.1:3000"],
      skins: ["*:3001"],
      "retro-games": ["127.0.0.1:3002"],
      comics: ["*:3003"],
      watches: ["127.0.0.1:3004"],
      whisky: ["127.0.0.1:3005"],
    });
  });

  it.skipIf(!realCompose)("is back to localhost once a run without --lan has removed it", () => {
    expect(run(["--lan", "--all"]).code).toBe(0);
    expect(Object.values(published()).flat().every((p) => p.startsWith("*:"))).toBe(true);
    expect(run().code).toBe(0);
    expect(Object.values(published()).flat().every((p) => p.startsWith("127.0.0.1:"))).toBe(true);
  });
});

/**
 * install.ps1 cannot be run where this suite runs (no PowerShell), so what is
 * pinned here is only what can be read off the text: that it agrees with
 * install.sh on the facts the two share, and does not do what is known to fail
 * under Windows PowerShell 5.1. It does not show that the script works.
 */
describe("scripts/install.ps1, by its text", () => {
  const ps1 = fs.readFileSync(path.join(repo, "scripts/install.ps1"), "utf8");
  const sh = fs.readFileSync(path.join(repo, "scripts/install.sh"), "utf8");

  it("is plain ASCII, which Windows PowerShell 5.1 reads correctly without a byte-order mark", () => {
    expect(ps1.match(/[^\x00-\x7f]/g)).toBeNull();
  });

  it("gives a launch that works under the default execution policy", () => {
    expect(ps1).toContain("powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\install.ps1");
  });

  it("has the same apps, ports and variable prefixes as install.sh", () => {
    for (const app of APPS) {
      expect(ps1, app).toContain(`'${app}' = ${PORTS[app]}`);
      expect(ps1, app).toContain(`'${app}' = '${PREFIX[app]}'`);
      expect(sh, app).toMatch(new RegExp(`${app}\\) echo ${PORTS[app]} ;;`));
      expect(sh, app).toContain(`${app}) echo "${PREFIX[app]}" ;;`);
    }
  });

  it("marks the override it writes exactly as install.sh does, so each leaves the other's alone", () => {
    const mark = /OVERRIDE_MARK="(.*)"/.exec(sh)![1]!;
    expect(ps1).toContain(`$OverrideMark = '${mark}'`);
  });

  it("asks docker without redirecting its error output under $ErrorActionPreference = 'Stop', which 5.1 turns into a crash", () => {
    expect(ps1).not.toMatch(/docker[^\n]*(\*>|2>\s*\$null)/);
    expect(ps1).toContain("$ErrorActionPreference = 'Continue'");
  });

  it("reads and writes .env as UTF-8 by name, and moves a finished copy onto it", () => {
    expect(ps1).not.toMatch(/Get-Content|Set-Content|Out-File/);
    expect(ps1).toContain("Move-Item -LiteralPath $tmp -Destination $EnvPath");
    expect(ps1).toContain("UTF8Encoding $false");
    expect(ps1).toContain("$script:LastTempIsPrivate");
  });

  it("holds the health ask to a few seconds", () => {
    expect(ps1).toMatch(/Invoke-WebRequest[^\n]*-TimeoutSec 5/);
  });
});

maybe("the files the installer depends on", () => {
  it("has every shell script executable, so ./scripts/install.sh runs as the documentation says", () => {
    const scripts = fs.readdirSync(path.join(repo, "scripts")).filter((n) => n.endsWith(".sh"));
    expect(scripts).toContain("install.sh");
    for (const name of scripts) {
      expect(fs.statSync(path.join(repo, "scripts", name)).mode & 0o111, `${name} is executable`).not.toBe(0);
      expect(fs.readFileSync(path.join(repo, "scripts", name), "utf8"), `${name} has LF line endings`).not.toContain("\r");
    }
  });

  it("is checked out with LF line endings on every platform", () => {
    const attributes = fs.readFileSync(path.join(repo, ".gitattributes"), "utf8").split("\n");
    expect(attributes).toContain("*.sh text eol=lf");
  });
});
