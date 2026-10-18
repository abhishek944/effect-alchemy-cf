/**
 * Authenticated JSON boundaries for the saved profile and the account theme.
 *
 * Avatar bytes use a dedicated native route (upload/read/cancel) because they
 * are binary; everything else is schema-defined JSON with the shared chat
 * authentication middleware, so it inherits the session check, same-origin
 * mutation guard and no-store responses.
 */
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { ChatAuthentication } from "./chat-auth.ts";
import { ChatPreferenceConflict } from "./chat-capability-api.ts";
import { ChatForbidden, ChatInvalid, ChatNotFound, ChatUnavailable } from "./chat-model.ts";
import { ProfileResponse, ProfileWrite } from "./profile-model.ts";
import { ManualThemeWrite, ThemeResponse } from "./theme-model.ts";

const errors = [ChatForbidden, ChatInvalid, ChatNotFound, ChatUnavailable, ChatPreferenceConflict];

export class AccountApi extends HttpApiGroup.make("account")
  .add(
    HttpApiEndpoint.get("profile", "/api/profile", {
      success: ProfileResponse,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.patch("writeProfile", "/api/profile", {
      payload: ProfileWrite,
      success: ProfileResponse,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("accountTheme", "/api/theme", {
      success: ThemeResponse,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.put("writeAccountTheme", "/api/theme", {
      payload: ManualThemeWrite,
      success: ThemeResponse,
      error: errors,
    }),
  )
  .middleware(ChatAuthentication) {}
