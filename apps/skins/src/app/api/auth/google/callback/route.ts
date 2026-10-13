import { googleCallback } from "../../route";

/** GET — Google sends the browser back here; signed in, or back to the login page with ?signin=failed. */
export const GET = googleCallback;
