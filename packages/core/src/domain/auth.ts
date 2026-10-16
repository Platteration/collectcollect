import { createAuth, type Auth } from "../auth";

/**
 * What a domain app answers without a session, or its login page and the
 * installed app could not load: the sign-in itself, and the files a phone
 * fetches before anyone has signed in (the offline notice, the web manifest,
 * the icons and favicon, the service worker). The cards and skins apps list the
 * same, bar the favicon, which they do not serve at its own address, and their
 * health route, which these apps do not have. `/guard.js` and `/_next/static`
 * are the proxy's own (SITE_PATHS).
 */
export const DOMAIN_PUBLIC_PATHS: readonly string[] = ["/login", "/api/auth", "/offline", "/manifest.webmanifest", "/icons", "/favicon.ico", "/sw.js"];

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
