import { createClerkClient, type ClerkClient } from "@clerk/backend";

export interface ClerkSettings {
  readonly secretKey: string | undefined;
  readonly publishableKey: string | undefined;
  readonly authorizedParties: string[];
}

/** Only explicitly selected, nonsecret fields cross this boundary. */
export const readClerkSettings = (
  env: Readonly<Record<string, string | undefined>>,
): ClerkSettings => ({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  authorizedParties: (env.CLERK_AUTHORIZED_PARTIES ?? "")
    .split(",")
    .map((party) => party.trim())
    .filter(Boolean),
});

const clients = new WeakMap<ClerkSettings, ClerkClient>();

/** One client per settings record; throws when the instance is unconfigured. */
export const clerkClient = (settings: ClerkSettings): ClerkClient => {
  const existing = clients.get(settings);
  if (existing !== undefined) return existing;
  if (settings.secretKey === undefined || settings.secretKey.length === 0)
    throw new Error("CLERK_SECRET_KEY is not configured");
  const client = createClerkClient({
    secretKey: settings.secretKey,
    ...(settings.publishableKey === undefined || settings.publishableKey.length === 0
      ? {}
      : { publishableKey: settings.publishableKey }),
  });
  clients.set(settings, client);
  return client;
};
