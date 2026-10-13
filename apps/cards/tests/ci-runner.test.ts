import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * CI's check job installs Playwright's Chromium (`npx playwright install --with-deps
 * chromium`), which downloads the build the locked Playwright names for the runner's
 * Ubuntu release and fails where it names none. `ubuntu-latest` is a label that moves:
 * from 2026-10-19 it is Ubuntu 26.04, for which Playwright 1.56.1 has no Chromium build,
 * so the check job would have gone red with nothing in the repository changed. So a job
 * that installs the browser runs on a named release, and one the locked Playwright has a
 * build for, asked of Playwright itself: its own CLI, told that release's platform, says
 * what it would download (--dry-run: nothing is fetched).
 */
const REPO = path.join(import.meta.dirname, "../../..");
const WORKFLOW = path.join(REPO, ".github/workflows/ci.yml");

/** The workflow's jobs, read from its block YAML: each job's name, its runs-on, and whether a step installs Playwright's browser. */
function jobs(): Array<{ name: string; runsOn: string | null; installsBrowser: boolean }> {
  const lines = fs.readFileSync(WORKFLOW, "utf8").split("\n");
  const start = lines.indexOf("jobs:");
  expect(start).toBeGreaterThanOrEqual(0);
  const out: Array<{ name: string; runsOn: string | null; installsBrowser: boolean }> = [];
  for (const line of lines.slice(start + 1)) {
    const job = /^ {2}([\w-]+):\s*$/.exec(line);
    if (job?.[1]) {
      out.push({ name: job[1], runsOn: null, installsBrowser: false });
      continue;
    }
    const current = out.at(-1);
    if (!current || line.trimStart().startsWith("#")) continue;
    const runsOn = /^ {4}runs-on:\s*(\S+)\s*$/.exec(line);
    if (runsOn?.[1]) current.runsOn = runsOn[1];
    if (/\bplaywright install\b/.test(line)) current.installsBrowser = true;
  }
  return out;
}

/** The Playwright the lockfile installs. */
const LOCKED: string = JSON.parse(fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8")).packages["node_modules/playwright"].version;

/**
 * What the locked Playwright's CLI would download for Chromium on `platform` (named as
 * Playwright names one, `ubuntu24.04-x64`): the download address, or null when it has none.
 */
function chromiumDownload(platform: string): string | null {
  const browsers = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-pw-"));
  try {
    const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");
    const run = spawnSync(process.execPath, [cli, "install", "--dry-run", "chromium"], {
      encoding: "utf8",
      env: { ...process.env, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: platform, PLAYWRIGHT_BROWSERS_PATH: browsers },
    });
    expect(run.status, `playwright install --dry-run chromium on ${platform}: ${run.stderr}`).toBe(0);
    // One block per browser, a blank line between; Chromium's is headed "browser: chromium version …".
    const block = run.stdout.split(/\n\s*\n/).find((b) => /^browser: chromium version /.test(b));
    expect(block, `the dry run names Chromium on ${platform}:\n${run.stdout}`).toBeDefined();
    return /^\s*Download url:\s*(\S+)/m.exec(block ?? "")?.[1] ?? null;
  } finally {
    fs.rmSync(browsers, { recursive: true, force: true });
  }
}

describe("the runner CI installs Playwright's browser on", () => {
  it("is a named Ubuntu release the locked Playwright has a Chromium build for, never a label that moves", () => {
    const installing = jobs().filter((job) => job.installsBrowser);
    expect(installing.map((job) => job.name)).toEqual(["check"]);
    for (const job of installing) {
      const release = /^ubuntu-(\d{2}\.\d{2})$/.exec(job.runsOn ?? "");
      expect(release, `the ${job.name} job runs on ${job.runsOn}; a job that installs the browser runs on a named Ubuntu release (ubuntu-24.04)`).not.toBeNull();
      expect(chromiumDownload(`ubuntu${release?.[1]}-x64`), `Playwright ${LOCKED} has no Chromium build for ${job.runsOn}: raise Playwright, or keep the job on a release it supports`).not.toBeNull();
    }
    // The reason in ci.yml names the Playwright that is locked, so raising it is a reason to read the runner again.
    expect(fs.readFileSync(WORKFLOW, "utf8")).toContain(`Playwright ${LOCKED} has no Chromium build for 26.04`);
  });

  it("is asked the right question: the locked CLI names a build for 24.04, and 1.56.1 none for 26.04", () => {
    expect(chromiumDownload("ubuntu24.04-x64")).toMatch(/^https:\/\/\S+\.zip$/);
    if (LOCKED === "1.56.1") expect(chromiumDownload("ubuntu26.04-x64")).toBeNull();
  });
});
