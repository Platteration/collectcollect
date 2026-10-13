import { googleStart } from "../../route";

/** GET — leave for Google to sign in (packages/core/src/google-signin.ts); a 404 when it is not set up. */
export const GET = googleStart;
