import { createThrottle } from "@collectcollect/core/throttle";
/** Manual identification and persistent scans spend from the same allowance. */
export const identificationThrottle = createThrottle(10, 60_000, "identifications");
