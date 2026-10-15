import { createRoutes } from "@collectcollect/core/domain/routes";
import { engine } from "./engine";

/** Every API handler, written once in the shared package; the route files re-export them. */
export const routes = createRoutes(engine);
