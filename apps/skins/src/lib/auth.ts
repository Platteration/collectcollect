import path from "node:path";
import { createAuth } from "@collectcollect/core/auth";
import { createSessionSeed } from "@collectcollect/core/session-seed";
import { googleVariables } from "@collectcollect/core/google-config";
import { dataDir } from "./paths";

/**
 * This app's gate. Set SKINS_APP_PASSWORD, or set up sign-in with Google
 * (SKINS_APP_URL and SKINS_GOOGLE_*), or both, to require a login; leave them
 * all unset and the app behaves as if there were no gate at all.
 *
 * Its own variable and its own cookie, not the card app's. Cookies are scoped
 * to a host and not to a port, so two of these served from localhost would
 * otherwise hand each other their sessions.
 */
export const auth = createAuth({
  cookie: "cc_skins_session",
  passwordEnv: "SKINS_APP_PASSWORD",
  secretEnv: "SKINS_APP_SECRET",
  secretPrefix: "collectcollect-skins:",
  // A random signing key in `session-secret` beside the inventory, so a stolen
  // cookie is no help in guessing the password. Resolved on first use, like
  // the session file, so loading the proxy at build time creates nothing.
  seed: createSessionSeed(() => path.join(dataDir(), "session-secret")),
  // Sign-in with Google beside the password, or in its place: SKINS_APP_URL and
  // SKINS_GOOGLE_*, its own variables like the password, and a state cookie of
  // its own name (packages/core/src/google-config.ts).
  google: { variables: googleVariables("SKINS_"), cookie: "__Host-collectcollect-skins-oauth" },
});

export const { SESSION_COOKIE, SESSION_DAYS } = auth;
export const authEnabled = auth.authEnabled;
export const passwordMatches = auth.passwordMatches;
export const createToken = auth.createToken;
export const verifyToken = auth.verifyToken;
