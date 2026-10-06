import { createAuthClient } from "better-auth/react";

// Better Auth's default /api/auth endpoint stays same-origin in dev and production.
export const authClient = createAuthClient();
