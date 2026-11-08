import { Context, Effect, Layer, Schema } from "effect";
import { clerkClient, readClerkSettings, type ClerkSettings } from "./client.ts";

/** No session, or a session the server cannot verify. */
export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  { reason: Schema.Literals(["signed-out", "handshake", "expired", "invalid"]) },
  { httpApiStatus: 401 },
) {}

/** Clerk itself is unreachable or unconfigured: never a denial. */
export class IdentityUnavailable extends Schema.TaggedError<IdentityUnavailable>()(
  "IdentityUnavailable",
  {},
  { httpApiStatus: 503 },
) {}

export const Identity = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  /** App-wide administrator, from server-controlled Clerk public metadata. */
  admin: Schema.Boolean,
});
export type Identity = typeof Identity.Type;

export class ClerkIdentity extends Context.Service<
  ClerkIdentity,
  {
    /** Verified identity for the current request, or a typed failure. */
    readonly current: (
      request: Request,
    ) => Effect.Effect<Identity, Unauthenticated | IdentityUnavailable>;
  }
>()("highchat/ClerkIdentity") {}

const displayName = (user: {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly username: string | null;
}): string =>
  [user.firstName, user.lastName].filter((part): part is string => Boolean(part)).join(" ") ||
  user.username ||
  "";

const emailOf = (user: {
  readonly primaryEmailAddressId: string | null;
  readonly emailAddresses: readonly { readonly id: string; readonly emailAddress: string }[];
}): string =>
  user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)?.emailAddress ??
  user.emailAddresses[0]?.emailAddress ??
  "";

const adminOf = (user: { readonly publicMetadata: Record<string, unknown> }): boolean =>
  user.publicMetadata.role === "admin";

const statusOf = (state: {
  readonly status: string;
  readonly reason?: unknown;
}): Unauthenticated => {
  const reason = typeof state.reason === "string" ? state.reason : "";
  if (state.status === "handshake") return new Unauthenticated({ reason: "handshake" });
  if (reason.includes("expired")) return new Unauthenticated({ reason: "expired" });
  if (state.status === "signed-out") return new Unauthenticated({ reason: "signed-out" });
  return new Unauthenticated({ reason: "invalid" });
};

/**
 * One verification and one Backend API read per request. Reading the live user
 * record is what makes a role change take effect on the next request instead of
 * on the next session refresh.
 */
const make = (settings: ClerkSettings): ClerkIdentity["Service"] => {
  return {
    current: (request) =>
      Effect.tryPromise({
        try: async (): Promise<Identity | Unauthenticated> => {
          const clerk = clerkClient(settings);
          const parties = settings.authorizedParties;
          const state = await clerk.authenticateRequest(request, {
            acceptsToken: "session_token",
            ...(parties.length === 0 ? {} : { authorizedParties: parties }),
          });
          if (state.status !== "signed-in") return statusOf(state);
          const session = state.toAuth();
          const userId: string | null = session.userId;
          if (userId === null) return new Unauthenticated({ reason: "invalid" });
          const user = await clerk.users.getUser(userId);
          return {
            id: user.id,
            name: displayName(user),
            email: emailOf(user),
            admin: adminOf(user),
          };
        },
        // A Clerk exception is an outage, not a denial; the caller returns 503.
        catch: () => new IdentityUnavailable(),
      }).pipe(
        Effect.flatMap((result) =>
          result instanceof Unauthenticated ? Effect.fail(result) : Effect.succeed(result),
        ),
      ),
  };
};

export const clerkIdentityLayer = (settings: ClerkSettings): Layer.Layer<ClerkIdentity> =>
  Layer.succeed(ClerkIdentity, make(settings));

/** Re-exported so one module owns the settings shape for both Clerk layers. */
export { readClerkSettings, type ClerkSettings };
