import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "./e2e-data-dir.mjs";

// Run the actual Next production entry point in one known process. Playwright's
// shell taskkill can leave npm's grandchildren alive on Windows; teardown stops
// this test-owned PID directly before asking Playwright to release its wrapper.
process.env.NODE_ENV ??= "production";
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Expected a port between 1024 and 65535");
// The app being started names its own variable (DATA_DIR or SKINS_DATA_DIR).
const directory = resolveDataDir(process.argv[3]);
fs.mkdirSync(directory, { recursive: true });
const marker = path.join(directory, "e2e-server.pid");
fs.writeFileSync(marker, String(process.pid), { flag: "wx" });
process.on("exit", () => { try { if (fs.readFileSync(marker, "utf8") === String(process.pid)) fs.unlinkSync(marker); } catch (error) { if (error.code !== "ENOENT") console.error(error); } });
const { nextStart } = await import("next/dist/cli/next-start.js");
await nextStart({ port, hostname: "127.0.0.1" }, process.cwd());
