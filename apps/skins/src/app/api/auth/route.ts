import { auth } from "@/lib/auth";
import { sessions } from "@/lib/sessions";
import { createAuthRoutes } from "@collectcollect/core/auth-route";

export const { POST, DELETE, revokeAll } = createAuthRoutes(auth, { sessions });
