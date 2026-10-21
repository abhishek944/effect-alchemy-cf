import { Auth } from "@starter/auth";
import { AuthLive } from "@starter/auth/cloudflare";
import { BillingStore } from "@starter/auth/billing-store";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Http from "alchemy/Http";
import { Config, Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { serveAssets } from "./assets.ts";
import { ChatNamespaces, ChatNamespacesLive, declareChatObjects } from "./chat-bindings.ts";
import { handleChatEvents } from "./chat-http-events.ts";
import { handleChatMedia, isChatMediaPath } from "./chat-media-http.ts";
import { handleProfilePhoto, isProfilePhotoPath } from "./profile-photo-http.ts";
import { handleSkills, isSkillsPath } from "./skills-http.ts";
import { limitChatBody } from "./chat-ingress.ts";
import { isChatPath } from "./chat-internal.ts";
import { HttpLive } from "./http.ts";
import { workerOptions } from "./options.ts";
import { BillingRuntime } from "./billing-config.ts";
import { BillingHooks } from "./billing-hooks.ts";
import {
  handleBillingWebhook,
  isBillingPath,
  limitBillingBody,
  webhookProvider,
} from "./billing-ingress.ts";
import { observeRequest, TelemetryLive } from "./observability.ts";
import OfficeHostLive, { makeOfficeHumanRegistrar } from "./office-host-object.ts";
import { isOfficePath, makeOfficeHttp } from "./office-http.ts";
import { officePrivateNamespace } from "./office-private-bindings.ts";

export default class ApiWorker extends Cloudflare.Worker<ApiWorker>()(
  "Api",
  workerOptions,
  Effect.gen(function* () {
    const auth = yield* Auth;
    const billingStore = yield* BillingStore;
    const billing = yield* BillingRuntime;
    const billingHooks = yield* BillingHooks;
    const namespaces = yield* ChatNamespaces;
    yield* declareChatObjects;
    const http = yield* HttpRouter.toHttpEffect(HttpLive);
    const office = yield* makeOfficeHttp({
      registry: yield* makeOfficeHumanRegistrar,
      // Raw platform binding is resolved per authenticated Office request, never at build time.
      namespace: officePrivateNamespace,
    });
    const chatMedia = handleChatMedia.pipe(
      Effect.provideService(Auth, auth),
      Effect.provideService(ChatNamespaces, namespaces),
    );
    const profilePhoto = handleProfilePhoto.pipe(
      Effect.provideService(Auth, auth),
      Effect.provideService(ChatNamespaces, namespaces),
    );
    const skills = handleSkills.pipe(
      Effect.provideService(Auth, auth),
      Effect.provideService(ChatNamespaces, namespaces),
    );
    const chatEvents = handleChatEvents.pipe(
      Effect.provideService(Auth, auth),
      Effect.provideService(ChatNamespaces, namespaces),
    );
    return {
      fetch: observeRequest(
        Effect.gen(function* () {
          const initial = yield* HttpServerRequest;
          // HttpServerRequest.url is relative (fromWeb removes the host); never
          // pass it to `new URL` without a base.
          const initialPath = initial.url.split("?")[0] ?? "";
          const chatPath = isChatPath(initialPath);
          const officePath = isOfficePath(initialPath);
          const billingPath = isBillingPath(initialPath);
          const skillsPath = isSkillsPath(initialPath);
          const response = yield* Http.safeHttpEffect(
            Effect.gen(function* () {
              const accessRequired = yield* Config.Boolean("REQUIRE_ACCESS").pipe(Effect.orDie);
              if (accessRequired && (yield* Cloudflare.Access.Context) === undefined) {
                return HttpServerResponse.text("Cloudflare Access required", { status: 403 });
              }
              const request = yield* HttpServerRequest;
              const pathname = request.url.split("?")[0] ?? "";
              if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
                return yield* auth.fetch.pipe(Effect.withSpan("auth.handle"));
              }
              // Authenticated Office surface: real CurrentOfficeSession plus the registrar.
              if (isOfficePath(pathname)) return yield* office;
              if (isBillingPath(pathname)) {
                const provider = webhookProvider(pathname);
                const run = provider === undefined ? http : handleBillingWebhook(provider);
                if (request.method === "GET" || request.method === "HEAD") return yield* run;
                const limited = yield* limitBillingBody(request, provider !== undefined);
                if (limited === null)
                  return HttpServerResponse.text("Payload too large", { status: 413 });
                return yield* run.pipe(Effect.provideService(HttpServerRequest, limited));
              }
              if (isProfilePhotoPath(pathname)) return yield* profilePhoto;
              if (isSkillsPath(pathname)) return yield* skills;
              if (isChatPath(pathname)) {
                if (isChatMediaPath(pathname)) return yield* chatMedia;
                if (request.method !== "GET" && request.method !== "HEAD") {
                  // Bound actual streamed bytes before any body parsing/decoding.
                  const limited = yield* limitChatBody(request);
                  if (!limited.ok) return limited.response;
                  return yield* http.pipe(
                    Effect.withSpan("api.handle"),
                    Effect.provideService(HttpServerRequest, limited.request),
                  );
                }
                if (pathname.startsWith("/api/chats/") && pathname.endsWith("/events")) {
                  return yield* chatEvents;
                }
                return yield* http.pipe(Effect.withSpan("api.handle"));
              }
              if (!pathname.startsWith("/api/")) return yield* serveAssets;
              return yield* http.pipe(Effect.withSpan("api.handle"));
            }),
          );
          // Every chat response, including auth/Origin/Access/schema/500 paths,
          // is non-cacheable after the outer safe-response encoding.
          return chatPath || billingPath || skillsPath || officePath
            ? HttpServerResponse.setHeader(response, "cache-control", "no-store")
            : response;
        }).pipe(
          Effect.provideService(BillingStore, billingStore),
          Effect.provideService(BillingRuntime, billing),
          Effect.provideService(BillingHooks, billingHooks),
        ),
      ),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        AuthLive,
        TelemetryLive,
        ChatNamespacesLive,
        // Actual DO layer: registers the OfficeHost export and provides the namespace tag
        // the real session registrar resolves once per Worker, never per request.
        OfficeHostLive,
        BillingStore.layer,
        BillingRuntime.layer,
        BillingHooks.layer,
      ),
    ),
  ),
) {}
