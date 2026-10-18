import type { BetterAuthPlugin } from "better-auth";

const text = { type: "string", required: true, input: false } as const;
const nullableText = { type: "string", required: false, input: false } as const;
const number = { type: "number", required: true, input: false } as const;
const index = (name: string, fields: [string, ...string[]], unique = false) => ({
  name,
  fields,
  unique,
});

/** Schema only: Alchemy's existing migration action owns the stage-isolated D1. */
export const billingSchema = {
  id: "starter-billing-schema",
  schema: {
    billingCustomer: {
      modelName: "billing_customer",
      fields: {
        scope: text,
        userId: text,
        providerKey: text,
        customerId: nullableText,
        createdAt: number,
      },
      indexes: [
        index("billing_customer_owner", ["scope", "userId"], true),
        index("billing_customer_provider", ["scope", "providerKey"], true),
      ],
    },
    billingCheckout: {
      modelName: "billing_checkout",
      fields: {
        userId: text,
        requestId: text,
        scope: text,
        slug: text,
        kind: text,
        productId: text,
        customerId: nullableText,
        state: text,
        sessionId: nullableText,
        sessionKey: text,
        subscriptionKey: text,
        resolution: text,
        url: nullableText,
        createdAt: number,
      },
      indexes: [
        index("billing_checkout_request", ["userId", "requestId"], true),
        index("billing_checkout_session", ["scope", "sessionKey"], true),
        index("billing_checkout_subscription", ["subscriptionKey"], true),
      ],
    },
    billingResource: {
      modelName: "billing_resource",
      fields: {
        scope: text,
        kind: text,
        providerId: text,
        userId: text,
        customerId: text,
        data: text,
        syncedAt: number,
      },
      indexes: [
        index("billing_resource_identity", ["scope", "kind", "providerId"], true),
        index("billing_resource_owner", ["userId", "scope"]),
      ],
    },
    billingEvent: {
      modelName: "billing_event",
      fields: {
        scope: text,
        providerId: text,
        type: text,
        reference: text,
        state: text,
        attempts: number,
        error: nullableText,
        leaseToken: nullableText,
        createdAt: number,
        updatedAt: number,
      },
      indexes: [
        index("billing_event_identity", ["scope", "providerId"], true),
        index("billing_event_pending", ["state", "updatedAt"]),
      ],
    },
    billingLock: {
      modelName: "billing_lock",
      fields: { token: text, admittedToken: text, expiresAt: number },
    },
  },
} satisfies BetterAuthPlugin;
