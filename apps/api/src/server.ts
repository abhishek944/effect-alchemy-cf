import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { clerkAdminUsersLayer } from "@highchat/auth/admin-users";
import { ClerkIdentity, clerkIdentityLayer, readClerkSettings } from "@highchat/auth";
import { runtimeEnvLayer, safeHttpEffect } from "@highchat/platform";
import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { createServer } from "node:http";
import { fileURLToPath, URL } from "node:url";
import { serveAssets } from "./assets.ts";
import { ChatNamespaces, ChatNamespacesLive } from "./chat-bindings.ts";
import { handleChatEvents } from "./chat-http-events.ts";
import { isChatPath } from "./chat-internal.ts";
import { handleChatMedia, isChatMediaPath } from "./chat-media-http.ts";
import { createRuntime } from "./environment.ts";
import { HttpLive } from "./http.ts";
import { observeRequest, TelemetryLive } from "./observability.ts";
import { handleProfilePhoto, isProfilePhotoPath } from "./profile-photo-http.ts";
import { handleSkills, isSkillsPath } from "./skills-http.ts";

const assetsRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const storageDir =
  process.env.CHAT_STORAGE_DIR ?? fileURLToPath(new URL("../../../var/storage/", import.meta.url));
const port = Number(process.env.PORT ?? 1337);
const host = process.env.HOST ?? "127.0.0.1";

const runtime = createRuntime({ storageDir, source: process.env });
const settings = readClerkSettings(process.env);

const app = Effect.gen(function* () {
  const ns = yield* ChatNamespaces;
  const identity = yield* ClerkIdentity;
  const api = yield* HttpRouter.toHttpEffect(HttpLive);
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(ChatNamespaces, ns),
      Effect.provideService(ClerkIdentity, identity),
    );
  const chatMedia = provide(handleChatMedia);
  const profilePhoto = provide(handleProfilePhoto);
  const skills = provide(handleSkills);
  const chatEvents = provide(handleChatEvents);
  return yield* observeRequest(
    Effect.gen(function* () {
      const initial = yield* HttpServerRequest;
      // HttpServerRequest.url is relative (fromWeb removes the host); never
      // pass it to `new URL` without a base.
      const initialPath = initial.url.split("?")[0] ?? "";
      const chatPath = isChatPath(initialPath);
      const skillsPath = isSkillsPath(initialPath);
      const response = yield* safeHttpEffect(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest;
          const pathname = request.url.split("?")[0] ?? "";
          if (isProfilePhotoPath(pathname)) return yield* profilePhoto;
          if (isSkillsPath(pathname)) return yield* skills;
          if (isChatPath(pathname)) {
            if (isChatMediaPath(pathname)) return yield* chatMedia;
            if (pathname.startsWith("/api/chats/") && pathname.endsWith("/events")) {
              return yield* chatEvents;
            }
            return yield* api.pipe(Effect.withSpan("api.handle"));
          }
          if (!pathname.startsWith("/api/")) return yield* serveAssets(assetsRoot);
          return yield* api.pipe(Effect.withSpan("api.handle"));
        }),
      );
      // Every chat response, including auth/Origin/schema/500 paths, is
      // non-cacheable after the outer safe-response encoding.
      return chatPath || skillsPath
        ? HttpServerResponse.setHeader(response, "cache-control", "no-store")
        : response;
    }),
  );
});

const layers = Layer.mergeAll(
  clerkIdentityLayer(settings),
  clerkAdminUsersLayer(settings),
  TelemetryLive,
  ChatNamespacesLive,
).pipe(Layer.provideMerge(runtimeEnvLayer(runtime.env)));

const program = Effect.scoped(
  Effect.gen(function* () {
    const server = yield* NodeHttpServer.make(() => createServer(), { port, host });
    const bound = server.address;
    yield* Effect.logInfo(`highchat listening on ${host}:${"port" in bound ? bound.port : port}`);
    yield* server.serve(app).pipe(Effect.provide(layers));
    // The server lives on the ambient scope; park until that scope closes.
    const park: Effect.Effect<never> = Effect.never;
    return yield* park;
  }),
).pipe(
  Effect.ensuring(
    Effect.sync(() => {
      runtime.close();
    }),
  ),
);

process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
Effect.runPromise(program).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
