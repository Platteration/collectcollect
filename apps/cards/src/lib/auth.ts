import { createAuth } from "@collectcollect/core/auth";

/**
 * This app's password gate. Set APP_PASSWORD to require a login; leave it unset
 * and the app behaves as if there were no gate at all.
 */
const auth = createAuth({
  cookie: "cc_session",
  passwordEnv: "APP_PASSWORD",
  secretEnv: "APP_SECRET",
  secretPrefix: "collectcollect:",
});

export const { SESSION_COOKIE, SESSION_DAYS } = auth;
export const authEnabled = auth.authEnabled;
export const passwordMatches = auth.passwordMatches;
export const createToken = auth.createToken;
export const verifyToken = auth.verifyToken;
export { timingSafeEqual } from "@collectcollect/core/auth";

/** The whole gate, for the shared route and proxy factories. */
export { auth };
