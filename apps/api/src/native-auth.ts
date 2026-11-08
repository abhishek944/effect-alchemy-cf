import { ClerkIdentity } from "@highchat/auth";
import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { authUnavailableEffect } from "./auth-failure.ts";

export interface NativeIdentity {
  /** The Web request already materialized for native handlers. */
  readonly web: Request;
  /** Verified owner id, or null when the request must not proceed. */
  readonly ownerId: string | null;
  /** Verified display name, or an empty string when the request is anonymous. */
  readonly name: string;
  /** True when the identity provider failed, which is a 503 and never a 401. */
  readonly outage: boolean;
}

type Outcome =
  | { readonly kind: "signed-in"; readonly id: string; readonly name: string }
  | { readonly kind: "signed-out" }
  | { readonly kind: "outage" };

/**
 * The native (multipart/binary/streaming) route identity boundary. It returns a
 * value instead of failing so each handler keeps its existing status choice.
 */
export const nativeIdentity: Effect.Effect<
  NativeIdentity,
  never,
  HttpServerRequest.HttpServerRequest | ClerkIdentity
> = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
  const identity = yield* ClerkIdentity;
  const outcome: Outcome = yield* identity.current(web).pipe(
    Effect.map((current) => ({ kind: "signed-in" as const, id: current.id, name: current.name })),
    Effect.catchTag("Unauthenticated", () => Effect.succeed({ kind: "signed-out" as const })),
    Effect.catchTag("IdentityUnavailable", () => Effect.succeed({ kind: "outage" as const })),
  );
  if (outcome.kind === "signed-in")
    return { web, ownerId: outcome.id, name: outcome.name, outage: false };
  if (outcome.kind === "outage") {
    // Report once here; the caller answers 503, never a denial.
    yield* Effect.ignore(
      authUnavailableEffect("native.identity", new Error("Identity provider unavailable")),
    );
    return { web, ownerId: null, name: "", outage: true };
  }
  return { web, ownerId: null, name: "", outage: false };
});
