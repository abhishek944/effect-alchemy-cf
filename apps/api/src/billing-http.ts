import { pendingEvents } from "@starter/auth/billing-data";
import type { BillingError } from "@starter/integrations/billing";
import { RuntimeContext } from "alchemy";
import { Effect } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { Api } from "./api.ts";
import { openBillingPortal, startBillingCheckout } from "./billing-checkout.ts";
import {
  BillingConflict,
  BillingForbidden,
  BillingInvalidInput,
  BillingMissing,
  BillingUnavailable,
} from "./billing-model.ts";
import { readBillingView } from "./billing-read.ts";
import { processBillingEvent, refreshBillingResource } from "./billing-sync.ts";
import { CurrentUser } from "./model.ts";

const apiError = (error: BillingError) => {
  if (error.kind === "InvalidInput" || error.kind === "Configuration")
    return new BillingInvalidInput();
  if (error.kind === "Conflict" || error.kind === "UnknownOutcome") return new BillingConflict();
  if (error.kind === "NotFound") return new BillingMissing();
  return new BillingUnavailable();
};

const mutationOrigin = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
  const origin = new URL(web.url).origin;
  if (web.headers.get("origin") !== origin) return yield* Effect.fail(new BillingForbidden());
  return origin;
});

export const BillingLive = HttpApiBuilder.group(Api, "billing", (handlers) =>
  handlers
    .handle("billingView", () =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        return yield* readBillingView(user.id).pipe(Effect.mapError(apiError));
      }).pipe(Effect.provide(RuntimeContext.phantom)),
    )
    .handle("billingCheckout", ({ payload }) =>
      Effect.gen(function* () {
        const origin = yield* mutationOrigin;
        const user = yield* CurrentUser;
        return yield* startBillingCheckout(user, payload.slug, payload.requestId, origin).pipe(
          Effect.mapError(apiError),
        );
      }).pipe(Effect.provide(RuntimeContext.phantom)),
    )
    .handle("billingPortal", ({ payload }) =>
      Effect.gen(function* () {
        const origin = yield* mutationOrigin;
        const user = yield* CurrentUser;
        return yield* openBillingPortal(user.id, payload.scope, origin).pipe(
          Effect.mapError(apiError),
        );
      }).pipe(Effect.provide(RuntimeContext.phantom)),
    )
    .handle("billingRefresh", ({ payload }) =>
      Effect.gen(function* () {
        yield* mutationOrigin;
        const user = yield* CurrentUser;
        yield* refreshBillingResource(payload.key, user.id).pipe(Effect.mapError(apiError));
        return { ok: true };
      }).pipe(Effect.provide(RuntimeContext.phantom)),
    ),
);

export const BillingAdminLive = HttpApiBuilder.group(Api, "billingAdmin", (handlers) =>
  handlers
    .handle("billingEvents", () =>
      pendingEvents().pipe(
        Effect.map((events) => ({ events })),
        Effect.mapError(apiError),
        Effect.provide(RuntimeContext.phantom),
      ),
    )
    .handle("billingReplay", ({ payload }) =>
      Effect.gen(function* () {
        yield* mutationOrigin;
        yield* processBillingEvent(payload.key).pipe(Effect.mapError(apiError));
        return { ok: true };
      }).pipe(Effect.provide(RuntimeContext.phantom)),
    )
    .handle("billingAdminRefresh", ({ payload }) =>
      Effect.gen(function* () {
        yield* mutationOrigin;
        yield* refreshBillingResource(payload.key).pipe(Effect.mapError(apiError));
        return { ok: true };
      }).pipe(Effect.provide(RuntimeContext.phantom)),
    ),
);
