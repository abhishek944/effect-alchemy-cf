import { Context, Effect, Layer, Schema } from "effect";
import { clerkClient, type ClerkSettings } from "./client.ts";
import { IdentityUnavailable } from "./identity.ts";

export const AdminUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.Literals(["user", "admin"]),
  emailVerified: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type AdminUser = typeof AdminUser.Type;

/** Backend API user lookups; the reachable surface of the removed local user store. */
export class ClerkAdminUsers extends Context.Service<
  ClerkAdminUsers,
  {
    readonly findByEmail: (email: string) => Effect.Effect<AdminUser | null, IdentityUnavailable>;
    readonly setRole: (
      id: string,
      role: "user" | "admin",
    ) => Effect.Effect<boolean, IdentityUnavailable>;
  }
>()("highchat/ClerkAdminUsers") {}

const primaryEmail = (user: {
  readonly primaryEmailAddressId: string | null;
  readonly emailAddresses: readonly { readonly id: string; readonly emailAddress: string }[];
}): string =>
  user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)?.emailAddress ??
  user.emailAddresses[0]?.emailAddress ??
  "";

const verified = (user: {
  readonly primaryEmailAddressId: string | null;
  readonly emailAddresses: readonly {
    readonly id: string;
    readonly verification: { readonly status: string } | null;
  }[];
}): boolean =>
  user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)?.verification
    ?.status === "verified";

/** A provider response status, without trusting an arbitrary error shape. */
const statusOf = (error: unknown): number | null => {
  if (typeof error !== "object" || error === null) return null;
  const status: unknown = Reflect.get(error, "status");
  return typeof status === "number" ? status : null;
};

const describe = (user: {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly username: string | null;
  readonly primaryEmailAddressId: string | null;
  readonly emailAddresses: readonly {
    readonly id: string;
    readonly emailAddress: string;
    readonly verification: { readonly status: string } | null;
  }[];
  readonly publicMetadata: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
}): AdminUser => ({
  id: user.id,
  name:
    [user.firstName, user.lastName].filter((part): part is string => Boolean(part)).join(" ") ||
    user.username ||
    "",
  email: primaryEmail(user),
  role: user.publicMetadata.role === "admin" ? "admin" : "user",
  emailVerified: verified(user),
  createdAt: new Date(user.createdAt).toISOString(),
  updatedAt: new Date(user.updatedAt).toISOString(),
});

export const clerkAdminUsersLayer = (settings: ClerkSettings): Layer.Layer<ClerkAdminUsers> =>
  Layer.succeed(ClerkAdminUsers, {
    findByEmail: (email) =>
      Effect.tryPromise({
        try: async () => {
          const response = await clerkClient(settings).users.getUserList({
            emailAddress: [email.toLowerCase()],
            limit: 1,
          });
          const [user] = response.data;
          return user === undefined ? null : describe(user);
        },
        catch: () => new IdentityUnavailable(),
      }),
    setRole: (id, role) =>
      Effect.tryPromise({
        try: async () => {
          const client = clerkClient(settings);
          try {
            await client.users.updateUserMetadata(id, { publicMetadata: { role } });
            return true;
          } catch (error) {
            // A user Clerk reports as absent is a domain outcome (404 UserNotFound),
            // never an identity outage.
            if (statusOf(error) === 404) return false;
            throw error;
          }
        },
        catch: () => new IdentityUnavailable(),
      }),
  });
