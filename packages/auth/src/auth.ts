import { BetterAuth } from "@alchemy.run/better-auth";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { Config, Context, Effect, Layer, Option } from "effect";

const makeAuth = Effect.gen(function* () {
  // Alchemy owns mode: context during planning, derived Worker binding at runtime.
  const local = globalThis.__ALCHEMY_RUNTIME__
    ? yield* Config.Boolean("AUTH_LOCAL").pipe(Config.withDefault(false))
    : Option.match(yield* Effect.serviceOption(AlchemyContext), {
        onNone: () => false,
        onSome: (context) => context.dev,
      });
  const baseURL = yield* Config.String("AUTH_BASE_URL").pipe(Config.option);
  return yield* BetterAuth({
    // Request outcomes are logged at the Worker boundary; suppress raw auth diagnostics.
    logger: { disabled: true },
    basePath: "/api/auth",
    baseURL: Option.getOrUndefined(baseURL)?.trim() || undefined,
    trustedOrigins: local ? ["http://localhost:5173"] : [],
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    advanced: {
      useSecureCookies: !local,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: { enabled: !local, storage: "database" },
  });
});

export class Auth extends Context.Service<Auth, Effect.Success<typeof makeAuth>>()("starter/Auth") {
  static readonly layer = Layer.effect(Auth, makeAuth);
}
