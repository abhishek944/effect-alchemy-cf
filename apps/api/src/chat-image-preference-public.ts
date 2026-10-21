import { Effect } from "effect";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { ChatAuthentication } from "./chat-auth.ts";
import { ChatNamespaces, doCall } from "./chat-bindings.ts";
import { ChatPreferenceConflict } from "./chat-capability-api.ts";
import {
  ImagePreferencesPublicView,
  ImagePreferencesView,
  ImagePreferencesWrite,
} from "./chat-image-preference-schema.ts";
import { decodeOrFail } from "./chat-internal.ts";
import { ChatForbidden, ChatInvalid, ChatUnavailable } from "./chat-model.ts";
import { CurrentUser } from "./model.ts";

const errors = [ChatForbidden, ChatInvalid, ChatPreferenceConflict, ChatUnavailable];
const path = "/api/account/images/preferences";

/** Authentication supplies the owner; preference reads/writes never contact image providers. */
export class ImagePreferencesApi extends HttpApiGroup.make("imagePreferences")
  .add(
    HttpApiEndpoint.get("imagePreferences", path, {
      success: ImagePreferencesPublicView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.patch("writeImagePreferences", path, {
      payload: ImagePreferencesWrite,
      success: ImagePreferencesPublicView,
      error: errors,
    }),
  )
  .middleware(ChatAuthentication) {}

// Same API identifier/group key as parent composition, without a root Api import cycle.
const PreferencesApi = HttpApi.make("starter").add(ImagePreferencesApi);

export const ImagePreferencesLive = HttpApiBuilder.group(
  PreferencesApi,
  "imagePreferences",
  (handlers) =>
    Effect.gen(function* () {
      const ns = yield* ChatNamespaces;
      const catalog = Effect.fnUntraced(function* (
        method: "GET" | "PATCH",
        payload?: ImagePreferencesWrite,
      ) {
        const user = yield* CurrentUser;
        const call = yield* doCall(ns.catalog(user.id), method, "/images/preferences", payload);
        if (call.status === 200) {
          const view = yield* decodeOrFail(ImagePreferencesView, call.body);
          return { ...view, configurationReady: ns.imageConfigured() };
        }
        if (call.status === 400)
          return yield* Effect.fail(new ChatInvalid({ message: "Invalid image preferences." }));
        if (call.status === 409)
          return yield* Effect.fail(
            new ChatPreferenceConflict({
              message: "Image preferences changed. Reload the saved values before saving again.",
            }),
          );
        return yield* Effect.fail(new ChatUnavailable());
      });
      return handlers
        .handle("imagePreferences", () => catalog("GET"))
        .handle("writeImagePreferences", ({ payload }) => catalog("PATCH", payload));
    }),
);
