import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { removeTestDirectory, stopTestServers } from "@collectcollect/core/test-directory";

it("rejects parent paths and unrecognized test roots before deleting anything", async () => {
  const prefix = "collectcollect-e2e-cleanup-test-";
  const target = path.join(os.tmpdir(), prefix + process.pid);
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "keep.txt"), "sentinel");
  try {
    await expect(removeTestDirectory(os.tmpdir(), prefix)).rejects.toThrow(/outside/);
    await expect(removeTestDirectory(target, "wrong-prefix-")).rejects.toThrow(/outside/);
    await expect(stopTestServers(target, prefix, [".."])).rejects.toThrow(/Invalid test data/);
    expect(await fs.readFile(path.join(target, "keep.txt"), "utf8")).toBe("sentinel");
  } finally { await removeTestDirectory(target, prefix); }
  await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not signal a malformed or current-process PID", async () => {
  const prefix = "collectcollect-e2e-pid-test-";
  const target = path.join(os.tmpdir(), prefix + process.pid);
  await fs.mkdir(path.join(target, "open"), { recursive: true });
  try {
    for (const pid of ["no", "1", String(process.pid)]) {
      await fs.writeFile(path.join(target, "open", "e2e-server.pid"), pid);
      await expect(stopTestServers(target, prefix, ["open"])).rejects.toThrow(/Invalid test server PID/);
    }
  } finally { await removeTestDirectory(target, prefix); }
});
