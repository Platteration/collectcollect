import path from "node:path";
import { createAuth, type Auth } from "../auth";
import { createSessionSeed } from "../session-seed";
import { domainDataDir } from "./data-dir";

/**
 * A domain app's password gate: its own variable and its own cookie. Cookies
 * are scoped to a host and not to a port, so two apps served from localhost
 * would otherwise hand each other their sessions. Kept apart from the engine
 * so the proxy can import it without pulling the database along.
 *
 * Sessions are signed with `<PREFIX>_APP_SECRET` when it is set, and otherwise
 * with a random key kept in `session-secret` beside the collection, as the
 * card and skins apps do. Without it the key was derived from the password
 * alone, which made a captured cookie an offline password-guessing oracle with
 * no rate limit. The key is resolved on first use, so loading this module
 * (the build does) creates nothing, and it is not part of a backup.
 */
export function domainAuth(id: string, envPrefix: string): Auth {
  return createAuth({
    cookie: `cc_${id.replace(/[^a-z0-9]/gi, "_")}_session`,
    passwordEnv: `${envPrefix}_APP_PASSWORD`,
    secretEnv: `${envPrefix}_APP_SECRET`,
    secretPrefix: `collectcollect-${id}:`,
    seed: createSessionSeed(() => path.join(domainDataDir(envPrefix), "session-secret")),
  });
}
