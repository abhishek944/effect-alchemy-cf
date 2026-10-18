import { Schema } from "effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { ChatAuthentication } from "./chat-auth.ts";
import { ChatCatalog } from "./chat-capability-policy.ts";
import {
  ChatForbidden,
  ChatIdParams,
  ChatInvalid,
  ChatNotFound,
  ChatUnavailable,
} from "./chat-model.ts";
import {
  AccountChatPreferencesView,
  ChatPreferencesView,
  ChatPreferencesWrite,
  ChatPreferencesWriteResult,
} from "./chat-preference-schema.ts";
import { SpeechPreferencesView, SpeechPreferencesWrite } from "./chat-speech-schema.ts";
import { ChatUsage } from "./chat-usage-schema.ts";

export class ChatPreferenceConflict extends Schema.TaggedError<ChatPreferenceConflict>()(
  "ChatPreferenceConflict",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

const errors = [ChatForbidden, ChatInvalid, ChatNotFound, ChatUnavailable, ChatPreferenceConflict];

/** Authenticated JSON boundaries; multipart and audio responses use native routes. */
export class ChatCapabilitiesApi extends HttpApiGroup.make("chatCapabilities")
  .add(
    HttpApiEndpoint.get("chatCapabilities", "/api/chat/capabilities", {
      success: ChatCatalog,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("accountChatPreferences", "/api/chat/preferences", {
      success: AccountChatPreferencesView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("chatPreferences", "/api/chats/:id/preferences", {
      params: ChatIdParams,
      success: ChatPreferencesView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.patch("writeChatPreferences", "/api/chats/:id/preferences", {
      params: ChatIdParams,
      payload: ChatPreferencesWrite,
      success: ChatPreferencesWriteResult,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("speechPreferences", "/api/chat/speech/preferences", {
      success: SpeechPreferencesView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.patch("writeSpeechPreferences", "/api/chat/speech/preferences", {
      payload: SpeechPreferencesWrite,
      success: SpeechPreferencesView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.get("chatUsage", "/api/chats/:id/usage", {
      params: ChatIdParams,
      success: ChatUsage,
      error: errors,
    }),
  )
  .middleware(ChatAuthentication) {}
