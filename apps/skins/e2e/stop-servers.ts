import { stopTestServers } from "@collectcollect/core/test-directory";
import { ROOT } from "./data-dir";

export default async function stopServers() {
  await stopTestServers(ROOT, "collectcollect-skins-e2e-", ["read", "write", "locked"]);
}
