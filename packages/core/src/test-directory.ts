import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function testDirectory(directory: string, prefix: string): string {
  const target = path.resolve(directory);
  const temp = path.resolve(os.tmpdir());
  const same = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!same(path.dirname(target), temp) || !path.basename(target).startsWith(prefix) || !/^\d+$/.test(path.basename(target).slice(prefix.length))) {
    throw new Error("Refusing to remove a path outside the generated test directory: " + target);
  }
  return target;
}

/** Remove only this run's generated immediate child of the system temp directory. */
export async function removeTestDirectory(directory: string, prefix: string): Promise<void> {
  const target = testDirectory(directory, prefix);
  const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Refusing to remove a test path that is not a real directory: " + target);
  await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Stop only the servers whose launcher wrote a PID inside this run's data dirs. */
export async function stopTestServers(directory: string, prefix: string, children: string[]): Promise<void> {
  const target = testDirectory(directory, prefix);
  const root = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (!root) return;
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Invalid test root: " + target);
  for (const child of children) {
    if (!/^(open|locked|read|write)$/.test(child)) throw new Error("Invalid test data directory");
    const folder = path.join(target, child);
    const stat = await fs.lstat(folder).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid test data directory: " + folder);
    const marker = path.join(folder, "e2e-server.pid");
    const raw = await fs.readFile(marker, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (raw === null) continue;
    const pid = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error("Invalid test server PID");
    const alive = () => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } };
    const signal = (name: NodeJS.Signals) => { try { process.kill(pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } };
    signal("SIGTERM");
    for (let attempts = 0; attempts < 20 && alive(); attempts++) await new Promise((resolve) => setTimeout(resolve, 100));
    if (alive()) {
      signal("SIGKILL");
      for (let attempts = 0; attempts < 20 && alive(); attempts++) await new Promise((resolve) => setTimeout(resolve, 100));
      if (alive()) throw new Error("Test server did not stop: " + pid);
    }
    await fs.rm(marker, { force: true });
  }
}
