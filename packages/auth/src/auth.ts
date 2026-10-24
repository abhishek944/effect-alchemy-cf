import { BetterAuth } from "@alchemy.run/better-auth";
import { reportFailureEffect, withCause, withDiagnostic } from "@starter/diagnostics";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { isAPIError } from "better-auth/api";
import { Config, Context, Effect, Layer, Option } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { adminOTA } from "./admin-ota.ts";
import { billingSchema } from "./billing-schema.ts";

/**
 * Better Auth answers API failures with Responses, so they never reach the Effect
 * ErrorReporter. Expected 4xx outcomes such as bad credentials, an expired session
 * or validation stay untouched domain responses. Unexpected failures are thrown as an
 * app-owned error that better-call rethrows, so the request-scoped fetch wrapper below
 * reports them once with the inherited request id and route, then encodes a fixed 500.
 * The hook receives the instance auth context, not request headers or cookies.
 */
const reportAuthApiFailure = (error: unknown): void => {
  const unexpected = !isAPIError(error) || error.statusCode >= 500;
  if (!unexpected) return;
  throw withCause(
    withDiagnostic(
      new Error("Authentication API failure"),
      isAPIError(error) ? "auth-api-internal" : "auth-api-unhandled",
    ),
    error,
  );
};

/** Preserve the previous fixed 500 body while reporting the original cause once. */
const reportFetchFailure = (
  defect: unknown,
): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
  Effect.gen(function* () {
    // The request-scoped annotations supply the request id and finite route.
    yield* reportFailureEffect(defect, {
      component: "auth",
      operation: "auth.api",
      status: 500,
      outcome: "failed",
    });
    return HttpServerResponse.jsonUnsafe({ message: "Internal Server Error" }, { status: 500 });
  });

const makeAuth = Effect.gen(function* () {
  // Alchemy owns mode: context during planning, derived Worker binding at runtime.
  const local = globalThis.__ALCHEMY_RUNTIME__
    ? yield* Config.Boolean("AUTH_LOCAL").pipe(Config.withDefault(false))
    : Option.match(yield* Effect.serviceOption(AlchemyContext), {
        onNone: () => false,
        onSome: (context) => context.dev,
      });
  const baseURL = yield* Config.String("AUTH_BASE_URL").pipe(Config.option);
  const instance = yield* BetterAuth({
    // Request outcomes are logged at the Worker boundary; suppress raw auth diagnostics.
    logger: { disabled: true },
    // Supported error hook: safe projection, fixed 500 for unexpected failures only.
    onAPIError: { onError: reportAuthApiFailure },
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
  return { ...instance, fetch: instance.fetch.pipe(Effect.catchDefect(reportFetchFailure)) };
});

export class Auth extends Context.Service<Auth, Effect.Success<typeof makeAuth>>()("starter/Auth") {
  static readonly layer = Layer.effect(Auth, makeAuth);
}
