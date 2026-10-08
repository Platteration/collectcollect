import path from "node:path";
import { createSessionStore } from "@collectcollect/core/sessions";
import { dataDir } from "./paths";

/**
 * Revoked sessions, in `sessions.json` beside the inventory. Resolved on
 * first use rather than at import, so loading the proxy at build time creates
 * no data directory beside the source.
 */
export const sessions = createSessionStore(() => path.join(dataDir(), "sessions.json"));
