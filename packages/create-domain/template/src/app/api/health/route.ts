import { createHealthRoute } from "@collectcollect/core/domain/health";
import { engine } from "@/lib/engine";

/** GET — is this server up, and does its collection answer? Public, for the image's health check. */
export const { GET } = createHealthRoute(engine);
