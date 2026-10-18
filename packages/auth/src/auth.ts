import { BetterAuth } from "@alchemy.run/better-auth";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { Config, Context, Effect, Layer, Option } from "effect";
import { adminOTA } from "./admin-ota.ts";
import { billingSchema } from "./billing-schema.ts";

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
    // A callback preserves Better Auth's inferred same-origin URL alongside local Vite.
    trustedOrigins: () => (local ? ["http://localhost:5173"] : []),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    user: {
      additionalFields: {
        // Scalar type lets Better Auth safely backfill existing D1 users with the default.
        role: { type: "string", defaultValue: "user", required: true, input: false },
      },
    },
    session: { cookieCache: { enabled: false } },
    plugins: [adminOTA, billingSchema],
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
