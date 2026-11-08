import type { SubscriptionFeatureIcon } from "./subscription-icons";

/**
 * Illustrative design content only.
 *
 * No plan catalog, price, feature entitlement or plan status is supplied by the
 * application. Every price is a sample and every feature group is a proposal.
 */
export type SubscriptionPlanId = "free" | "plus" | "max";

export type SubscriptionFeature = {
  readonly icon: SubscriptionFeatureIcon;
  readonly label: string;
};

export type SubscriptionPlan = {
  readonly id: SubscriptionPlanId;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly price: string;
  readonly recommended: boolean;
  readonly features: readonly SubscriptionFeature[];
};

export const SUBSCRIPTION_PLANS = [
  {
    id: "free",
    name: "Free",
    tagline: "Everyday conversations",
    description: "A simple place to begin.",
    price: "0",
    recommended: false,
    features: [
      { icon: "chat", label: "Chat conversations" },
      { icon: "history", label: "Saved conversation history" },
      { icon: "search", label: "Conversation search" },
    ],
  },
  {
    id: "plus",
    name: "Plus",
    tagline: "A broader workspace",
    description: "Bring files and images into the flow.",
    price: "20",
    recommended: true,
    features: [
      { icon: "check", label: "Everything in Free" },
      { icon: "file", label: "Files in conversations" },
      { icon: "image", label: "Image generation" },
    ],
  },
  {
    id: "max",
    name: "Max",
    tagline: "Create in more ways",
    description: "Use voice and reusable skills.",
    price: "50",
    recommended: false,
    features: [
      { icon: "check", label: "Everything in Plus" },
      { icon: "mic", label: "Voice conversations" },
      { icon: "sparkle", label: "Reusable skills" },
    ],
  },
] as const satisfies readonly SubscriptionPlan[];
