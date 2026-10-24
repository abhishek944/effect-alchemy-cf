import { reportFailureEffect } from "@starter/diagnostics";
import { billingError } from "@starter/integrations/billing";
import { RuntimeContext } from "alchemy";
import { Effect, ErrorReporter } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { BillingRuntime } from "./billing-config.ts";
import { readBoundedBody } from "./body-limit.ts";
import { receiveBillingEvent } from "./billing-sync.ts";
import { reportBillingFailureEffect } from "./billing-report.ts";

export const isBillingPath = (path: string) =>
  path === "/api/billing" ||
  path.startsWith("/api/billing/") ||
  path === "/api/admin/billing" ||
  path.startsWith("/api/admin/billing/");
export const webhookProvider = (path: string) =>
  /^\/api\/billing\/webhooks\/(dodo|polar)$/.exec(path)?.[1];

export const limitBillingBody = (request: HttpServerRequest.HttpServerRequest, webhook: boolean) =>
  Effect.gen(function* () {
    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
    const bytes = yield* Effect.promise(() =>
      readBoundedBody(web, webhook ? 1024 * 1024 : 16 * 1024),
    );
    if (bytes === null) return null;
    return HttpServerRequest.fromWeb(
      new Request(web.url, {
        method: web.method,
        headers: web.headers,
        body: bytes,
        signal: web.signal,
      }),
    );
  });

/** No app session is required, but the Worker's Access check still runs first. */
export const handleBillingWebhook = (provider: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== "POST")
      return HttpServerResponse.text("Method not allowed", { status: 405 });
    const runtime = yield* BillingRuntime;
    const entry = runtime.scopes.find((scope) => scope.provider === provider);
    if (!entry) {
      // An enabled endpoint without a configured provider is a fixed config failure, not a 500.
      yield* reportFailureEffect(billingError("Configuration"), {
        component: "billing",
        operation: "billing.webhook.configuration",
        provider,
        reason: "webhook-provider-unconfigured",
        outcome: "not-submitted",
        status: 503,
      });
      return HttpServerResponse.text("Webhook unavailable", { status: 503 });
    }
    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
    const raw = yield* Effect.promise(() => web.text());
    return yield* entry.adapter.verify(raw, web.headers).pipe(
      Effect.flatMap((event) => receiveBillingEvent(entry, event)),
      Effect.as(HttpServerResponse.jsonUnsafe({ received: true })),
      Effect.catch((error) =>
        // A post-verification failure already reported with the derived inbox key.
        (ErrorReporter.isIgnored(error)
          ? Effect.void
          : reportBillingFailureEffect("billing.webhook.receive", error, { provider })
        ).pipe(
          Effect.as(
            HttpServerResponse.text("Webhook unavailable", {
              status: error.kind === "Signature" || error.kind === "InvalidInput" ? 400 : 503,
            }),
          ),
        ),
      ),
      Effect.catchDefect((defect) =>
        reportFailureEffect(defect, {
          component: "billing",
          operation: "billing.webhook.receive",
          provider,
          reason: "webhook-unexpected",
          outcome: "unknown",
        }).pipe(Effect.as(HttpServerResponse.text("Webhook unavailable", { status: 503 }))),
      ),
      Effect.provide(RuntimeContext.phantom),
    );
  });
