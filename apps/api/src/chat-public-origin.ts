import { Effect, Schema } from "effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import { ImageApplicationOrigin } from "./chat-image-response-schema.ts";
import { ChatUnavailable } from "./chat-model.ts";

/** Call after authentication. OriginalUrl is the platform Request URL, not headers. */
export const publicApplicationOrigin = Effect.gen(function* () {
  const request = yield* HttpServerRequest;
  const origin = yield* Effect.try({
    try: () => new URL(request.originalUrl).origin,
    catch: () => new ChatUnavailable(),
  });
  return yield* Schema.decodeUnknownEffect(ImageApplicationOrigin)(origin).pipe(
    Effect.mapError(() => new ChatUnavailable()),
  );
});

/** Trusted worker-to-conversation transport only; never browser-selected. */
export const conversationApplicationOrigin = (request: Request): string | null => {
  const value = request.headers.get("x-chat-application-origin");
  return Schema.is(ImageApplicationOrigin)(value) ? value : null;
};
