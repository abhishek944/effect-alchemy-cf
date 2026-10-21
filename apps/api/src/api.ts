import { Schema } from "effect";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { AccountApi } from "./account-api.ts";
import { AdminApi } from "./admin-api.ts";
import { Authentication } from "./authentication.ts";
import { ChatApi } from "./chat-api.ts";
import { ChatCapabilitiesApi } from "./chat-capability-api.ts";
import { ImagePreferencesApi } from "./chat-image-preference-public.ts";
import { ChatLibraryApi } from "./chat-library-public.ts";
import { ChatImageReadsApi } from "./chat-image-read-public.ts";
import { BillingApi, BillingAdminApi } from "./billing-api.ts";
import { User } from "./model.ts";

class Public extends HttpApiGroup.make("public").add(
  HttpApiEndpoint.get("health", "/api/health", {
    success: Schema.Struct({ ok: Schema.Boolean }),
  }),
) {}

class Private extends HttpApiGroup.make("private")
  .add(HttpApiEndpoint.get("me", "/api/me", { success: User }))
  .middleware(Authentication) {}

export class Api extends HttpApi.make("starter")
  .add(Public)
  .add(Private)
  .add(AdminApi)
  .add(ChatApi)
  .add(ChatCapabilitiesApi)
  .add(ImagePreferencesApi)
  .add(ChatLibraryApi)
  .add(ChatImageReadsApi)
  .add(AccountApi)
  .add(BillingApi)
  .add(BillingAdminApi) {}
