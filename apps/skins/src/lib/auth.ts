import { createAuth } from "@collectcollect/core/auth";

/**
 * This app's password gate. Set SKINS_APP_PASSWORD to require a login; leave it
 * unset and the app behaves as if there were no gate at all.
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
});

export const { SESSION_COOKIE, SESSION_DAYS } = auth;
export const authEnabled = auth.authEnabled;
export const passwordMatches = auth.passwordMatches;
export const createToken = auth.createToken;
export const verifyToken = auth.verifyToken;
