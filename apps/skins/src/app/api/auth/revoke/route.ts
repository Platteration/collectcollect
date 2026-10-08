import { revokeAll } from "../route";

/** POST — sign out everywhere: every session issued so far is ended, this one included. */
export const POST = revokeAll;
