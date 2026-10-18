import {
  BillingProducts,
  billingError,
  type BillingAdapter,
  type BillingProducts as Products,
  type ProviderId,
} from "@starter/integrations/billing";
import { makeDodoBilling } from "@starter/integrations/billing-dodo";
import { makePolarBilling } from "@starter/integrations/billing-polar";
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Stack } from "alchemy/Stack";
import { serviceName } from "../../../service.config.ts";

export type BillingScope = { scope: string; provider: ProviderId; adapter: BillingAdapter };
export class BillingRuntime extends Context.Service<
  BillingRuntime,
  {
    readonly defaultProvider: ProviderId | null;
    readonly products: Products;
    readonly scopes: readonly BillingScope[];
    readonly namespace: string;
  }
>()("starter/BillingRuntime") {
  static readonly layer = Layer.effect(
    BillingRuntime,
    Effect.gen(function* () {
      const selected = yield* Config.String("BILLING_PROVIDER").pipe(Config.withDefault(""));
      const raw = yield* Config.String("BILLING_PRODUCTS").pipe(Config.withDefault("{}"));
      const stack = globalThis.__ALCHEMY_RUNTIME__
        ? Option.none()
        : yield* Effect.serviceOption(Stack);
      const namespace = globalThis.__ALCHEMY_RUNTIME__
        ? yield* Config.String("BILLING_NAMESPACE")
        : Option.match(stack, {
            onNone: () => `${serviceName}:dev_local`,
            onSome: (value) => `${value.name}:${value.stage}`,
          });
      const mode = globalThis.__ALCHEMY_RUNTIME__
        ? yield* Config.String("BILLING_ENVIRONMENT")
        : Option.match(stack, {
            onNone: () => "test",
            onSome: (value) => (value.stage === "prod" ? "live" : "test"),
          });
      if (!["", "dodo", "polar"].includes(selected) || !["test", "live"].includes(mode)) {
        return yield* Effect.fail(billingError("Configuration"));
      }
      const products = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BillingProducts))(
        raw,
      ).pipe(Effect.mapError(() => billingError("Configuration")));
      if (Object.keys(products).length > 20)
        return yield* Effect.fail(billingError("Configuration"));
      const scopes: BillingScope[] = [];
      for (const provider of ["dodo", "polar"] as const) {
        const prefix = provider.toUpperCase();
        const accountId = yield* Config.String(`${prefix}_ACCOUNT_ID`).pipe(Config.withDefault(""));
        if (!accountId) continue;
        const apiKey = yield* Config.Redacted(`${prefix}_API_KEY`).pipe(
          Config.withDefault(Redacted.make("")),
        );
        const webhookSecret = yield* Config.Redacted(`${prefix}_WEBHOOK_SECRET`).pipe(
          Config.withDefault(Redacted.make("")),
        );
        if (
          !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId) ||
          !Redacted.value(apiKey) ||
          !Redacted.value(webhookSecret)
        ) {
          return yield* Effect.fail(billingError("Configuration"));
        }
        const ids = Object.values(products).flatMap((product) =>
          product[provider] ? [product[provider]] : [],
        );
        if (new Set(ids).size !== ids.length)
          return yield* Effect.fail(billingError("Configuration"));
        const options = { accountId, apiKey, webhookSecret, live: mode === "live" };
        scopes.push({
          scope: `${namespace}/${provider}/${mode}/${accountId}`,
          provider,
          adapter: provider === "dodo" ? makeDodoBilling(options) : makePolarBilling(options),
        });
      }
      const defaultProvider: ProviderId | null =
        selected === "dodo" || selected === "polar" ? selected : null;
      if (defaultProvider !== null && !scopes.some((scope) => scope.provider === defaultProvider)) {
        return yield* Effect.fail(billingError("Configuration"));
      }
      return { defaultProvider, products, scopes, namespace };
    }).pipe(Effect.orDie),
  );
}

export const scopeById = (scope: string) =>
  Effect.gen(function* () {
    const runtime = yield* BillingRuntime;
    const found = runtime.scopes.find((entry) => entry.scope === scope);
    return found ? found : yield* Effect.fail(billingError("NotFound"));
  });
