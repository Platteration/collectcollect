import { stopTestServers } from "@collectcollect/core/test-directory";
import { ROOT } from "./data-dir";

export default async function stopServers() {
  await stopTestServers(ROOT, "collectcollect-e2e-", ["open", "locked"]);
}
