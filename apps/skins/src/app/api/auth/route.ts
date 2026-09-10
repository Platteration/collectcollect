import { auth } from "@/lib/auth";
import { createAuthRoutes } from "@collectcollect/core/auth-route";

export const { POST, DELETE } = createAuthRoutes(auth);
