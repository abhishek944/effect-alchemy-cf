import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { PAYLOAD_TOO_LARGE } from "./chat-model.ts";
import { readBoundedBody } from "./body-limit.ts";

/**
 * 128 KiB covers 16,000 escaped characters plus schema slack. The limit is
 * counted from streamed bytes, so a missing or wrong Content-Length cannot
 * bypass it, and the whole body is never parsed before the check.
 */
export const CHAT_BODY_LIMIT = 128 * 1024;

export type LimitedChatBody =
  | { readonly ok: true; readonly request: HttpServerRequest.HttpServerRequest }
  | { readonly ok: false; readonly response: HttpServerResponse.HttpServerResponse };

/** Buffers a chat request body up to the shared limit, or reports a 413. */
export const limitChatBody = (
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<LimitedChatBody> =>
  Effect.gen(function* () {
    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
    const bytes = yield* Effect.promise(() => readBoundedBody(web, CHAT_BODY_LIMIT)).pipe(
      Effect.orDie,
    );
    if (bytes === null) {
      return {
        ok: false as const,
        response: HttpServerResponse.setHeader(
          HttpServerResponse.text(JSON.stringify({ message: PAYLOAD_TOO_LARGE }), {
            status: 413,
          }),
          "cache-control",
          "no-store",
        ),
      };
    }
    const init: RequestInit = {
      method: web.method,
      headers: new Headers(web.headers),
      signal: web.signal,
    };
    if (web.method !== "GET" && web.method !== "HEAD") init.body = bytes;
    return { ok: true as const, request: HttpServerRequest.fromWeb(new Request(web.url, init)) };
  });
