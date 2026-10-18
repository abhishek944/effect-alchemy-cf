import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, formCsrfMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { Schema } from "effect";

const TokenBody = Schema.Struct({ token: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) });

// Provisioned offline, bound to an existing account, never issued through a public API.
export const adminOTA = {
  id: "admin-ota",
  endpoints: {
    adminOTALogin: createAuthEndpoint(
      "/admin-ota-login",
      {
        method: "POST",
        body: Schema.toStandardSchemaV1(TokenBody),
        use: [formCsrfMiddleware],
      },
      async (ctx) => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(ctx.body.token),
        );
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const adapter = ctx.context.internalAdapter;
        // Better Auth consumes verification rows atomically and rejects expired rows.
        const token = await adapter.consumeVerificationValue(`admin-ota:${hash}`);
        if (!token)
          throw ctx.error("UNAUTHORIZED", { message: "Invalid or expired one-time access token" });
        const user = await adapter.findUserById(token.value);
        if (!user)
          throw ctx.error("UNAUTHORIZED", { message: "Invalid or expired one-time access token" });
        const admin = await adapter.updateUser(user.id, { role: "admin" });
        const session = await adapter.createSession(admin.id, true);
        if (!session)
          throw ctx.error("INTERNAL_SERVER_ERROR", { message: "Unable to create session" });
        await setSessionCookie(ctx, { session, user: admin }, true);
        return ctx.json({ ok: true });
      },
    ),
  },
  rateLimit: [{ pathMatcher: (path) => path === "/admin-ota-login", window: 60, max: 5 }],
} satisfies BetterAuthPlugin;
