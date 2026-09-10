import { createAuth, type Auth } from "../auth";

/**
 * A domain app's password gate: its own variable and its own cookie. Cookies
 * are scoped to a host and not to a port, so two apps served from localhost
 * would otherwise hand each other their sessions. Kept apart from the engine
 * so the proxy can import it without pulling the database along.
 */
export function domainAuth(id: string, envPrefix: string): Auth {
  return createAuth({
    cookie: `cc_${id.replace(/[^a-z0-9]/gi, "_")}_session`,
    passwordEnv: `${envPrefix}_APP_PASSWORD`,
    secretEnv: `${envPrefix}_APP_SECRET`,
    secretPrefix: `collectcollect-${id}:`,
  });
}
