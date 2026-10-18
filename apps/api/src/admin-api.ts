import { Schema } from "effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { AdminAuthentication } from "./admin-authentication.ts";
import {
  AdminIdentity,
  AdminUserDetails,
  EmailSearch,
  Forbidden,
  Role,
  UserNotFound,
} from "./admin-model.ts";
import { AuthenticationUnavailable } from "./model.ts";

export class AdminApi extends HttpApiGroup.make("admin")
  .add(HttpApiEndpoint.get("adminMe", "/api/admin/me", { success: AdminIdentity }))
  .add(
    HttpApiEndpoint.post("searchUsers", "/api/admin/users/search", {
      payload: EmailSearch,
      success: Schema.Struct({ user: Schema.NullOr(AdminUserDetails) }),
      error: AuthenticationUnavailable,
    }),
  )
  .add(
    HttpApiEndpoint.patch("setRole", "/api/admin/users/:id/role", {
      params: Schema.Struct({
        id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
      }),
      payload: Schema.Struct({ role: Role }),
      success: Schema.Struct({ ok: Schema.Boolean }),
      error: [UserNotFound, Forbidden, AuthenticationUnavailable],
    }),
  )
  .middleware(AdminAuthentication) {}
