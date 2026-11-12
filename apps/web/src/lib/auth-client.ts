import { useClerk, useUser } from "@clerk/react";

/** Only the fields this app needs from a verified Clerk browser user. */
export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

const primaryEmail = (user: {
  readonly primaryEmailAddressId: string | null;
  readonly emailAddresses: readonly { readonly id: string; readonly emailAddress: string }[];
}): string =>
  user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)?.emailAddress ??
  user.emailAddresses[0]?.emailAddress ??
  "";

/**
 * A blank publishable key is a supported state: Clerk never loads, so sign-in is
 * unavailable rather than pending. Waiting on it would hang the page forever.
 */
const clerkConfigured = PUBLIC_CLERK_PUBLISHABLE_KEY.trim().length > 0;
const CLERK_MISSING = "Sign-in is unavailable: this environment has no Clerk publishable key.";

/**
 * The session surface this app reads. Clerk owns loading, refresh and the
 * session cookie; a background refresh never tears down a rendered page.
 */
export const authClient = {
  useSession(): { data: { user: SessionUser } | null; isPending: boolean; error: string | null } {
    const { isLoaded, isSignedIn, user } = useUser();
    const pending = clerkConfigured && !isLoaded;
    const session =
      isSignedIn && user && !pending
        ? {
            user: {
              id: user.id,
              name:
                [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "",
              email: primaryEmail(user),
            },
          }
        : null;
    return { data: session, isPending: pending, error: clerkConfigured ? null : CLERK_MISSING };
  },
};

/** Sign-out is a Clerk browser action, so it is exposed as a hook. */
export const useSignOut = () => {
  const clerk = useClerk();
  return () => clerk.signOut();
};
