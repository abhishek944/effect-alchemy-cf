import { Schema } from "effect";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Authentication } from "./authentication.ts";
import { User } from "./model.ts";

class Public extends HttpApiGroup.make("public").add(
  HttpApiEndpoint.get("health", "/api/health", {
    success: Schema.Struct({ ok: Schema.Boolean }),
  }),
) {}

class Private extends HttpApiGroup.make("private")
  .add(HttpApiEndpoint.get("me", "/api/me", { success: User }))
  .middleware(Authentication) {}

export class Api extends HttpApi.make("starter").add(Public).add(Private) {}
