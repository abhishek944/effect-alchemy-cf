import { withCause } from "@starter/diagnostics";
import { billingFailure, type ProviderId } from "@starter/integrations/billing";
import { Effect } from "effect";

const domains: Readonly<Record<ProviderId, string>> = {
  dodo: "dodopayments.com",
  polar: "polar.sh",
};

/**
 * Only the provider's own HTTPS host without embedded credentials is returned. Every
 * refusal keeps the existing Provider kind but names the failed check; the refused value
 * is never emitted and the URL policy itself is unchanged.
 */
export const hostedBillingUrl = (provider: ProviderId, value: string) =>
  Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => new URL(value),
      catch: (cause) => withCause(billingFailure("Provider", "billing-url-parse", provider), cause),
    });
    const domain = domains[provider];
    if (url.protocol !== "https:") {
      return yield* Effect.fail(billingFailure("Provider", "billing-url-protocol", provider));
    }
    if (url.username !== "" || url.password !== "") {
      return yield* Effect.fail(billingFailure("Provider", "billing-url-credentials", provider));
    }
    if (!(url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
      return yield* Effect.fail(billingFailure("Provider", "billing-url-host", provider));
    }
    return url.href;
  });
