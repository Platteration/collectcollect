import fs from "node:fs";
import path from "node:path";

// Run the actual Next production entry point in one known process. Playwright's
// shell taskkill can leave npm's grandchildren alive on Windows; teardown stops
// this test-owned PID directly before asking Playwright to release its wrapper.
process.env.NODE_ENV ??= "production";
const directory = process.env.DATA_DIR ?? process.env.SKINS_DATA_DIR;
const port = Number(process.argv[2]);
if (!directory || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Expected a test data directory and port");
fs.mkdirSync(directory, { recursive: true });
const marker = path.join(directory, "e2e-server.pid");
fs.writeFileSync(marker, String(process.pid), { flag: "wx" });
process.on("exit", () => { try { if (fs.readFileSync(marker, "utf8") === String(process.pid)) fs.unlinkSync(marker); } catch (error) { if (error.code !== "ENOENT") console.error(error); } });
const { nextStart } = await import("next/dist/cli/next-start.js");
await nextStart({ port, hostname: "127.0.0.1" }, process.cwd());
