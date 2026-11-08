import type * as cf from "./platform.ts";
import { RuntimeEnv } from "@highchat/platform";
import { withCause } from "@highchat/diagnostics";
import { Context, Effect, Layer, Schema } from "effect";
import { ChatUnavailable } from "./chat-model.ts";
import { imageTransportConfigured } from "./chat-model-transport.ts";
import { chatObservationHeaders, CHAT_OBSERVATION_REQUEST } from "./chat-observation.ts";

/** Drop caller-supplied observation headers; only generated annotations may set them. */
const callerHeaders = (headers: Record<string, string> | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers ?? {}).filter(
      ([name]) => name.toLowerCase() !== CHAT_OBSERVATION_REQUEST,
    ),
  );

export type ChatCatalogStub = cf.DurableObjectStub;
export type ChatConversationStub = cf.DurableObjectStub;

export class ChatNamespaces extends Context.Service<
  ChatNamespaces,
  {
    readonly catalog: (ownerId: string) => ChatCatalogStub;
    readonly conversation: (ownerId: string, chatId: string) => ChatConversationStub;
    /** Configuration presence only; never account entitlement or a paid health probe. */
    readonly imageConfigured: () => boolean;
  }
>()("highchat/ChatNamespaces") {}

/** The local runtime installs object namespaces directly; nothing is declared on a Worker. */
const isNamespace = (value: unknown): value is cf.DurableObjectNamespace =>
  typeof value === "object" &&
  value !== null &&
  "getByName" in value &&
  typeof value.getByName === "function";

/**
 * Resolves the object namespaces from the host environment record. The guard
 * keeps the untyped environment boundary honest instead of asserting a shape.
 */
export const ChatNamespacesLive = Layer.effect(
  ChatNamespaces,
  Effect.gen(function* () {
    const env = yield* RuntimeEnv;
    const namespace = (name: string): cf.DurableObjectNamespace => {
      const candidate: unknown = env[name];
      if (!isNamespace(candidate)) throw new Error(`Missing chat object binding ${name}`);
      return candidate;
    };
    return {
      catalog: (ownerId) => namespace("ChatCatalog").getByName(`owner:${ownerId}`),
      conversation: (ownerId, chatId) =>
        namespace("ChatConversation").getByName(`chat:${ownerId}:${chatId}`),
      imageConfigured: () => imageTransportConfigured(),
    };
  }),
);

export type DoCall = { readonly status: number; readonly body: unknown };

// Node and Worker declarations differ in event-listener variance. Require the
// native runtime signal at this private platform boundary instead of casting it.
const WorkerSignal = Schema.declare<cf.AbortSignal>(
  (value): value is cf.AbortSignal => value instanceof AbortSignal,
);

/** Raw call against an internal object route. Never reachable from browsers. */
export const doCall = (
  stub: cf.DurableObjectStub,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Effect.Effect<DoCall, ChatUnavailable> =>
  Effect.gen(function* () {
    const observation = yield* chatObservationHeaders;
    return yield* Effect.tryPromise({
      try: async () => {
        signal?.throwIfAborted();
        const transportSignal =
          signal === undefined ? undefined : Schema.decodeUnknownSync(WorkerSignal)(signal);
        const response = await stub.fetch(`https://chat.internal${path}`, {
          ...(transportSignal === undefined ? {} : { signal: transportSignal }),
          method,
          // Observation-only correlation; caller headers can never override it.
          headers: {
            "content-type": "application/json",
            ...callerHeaders(headers),
            ...observation,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        let parsed: unknown = null;
        if (text.length > 0) {
          try {
            parsed = JSON.parse(text);
          } catch (error) {
            // A malformed successful private reply is a failure, never absence.
            // Non-2xx bodies stay optional and authoritative status still wins.
            if (response.ok) throw error;
          }
        }
        return { status: response.status, body: parsed };
      },
      catch: (error) => withCause(new ChatUnavailable(), error),
    });
  });

/** Raw fetch for the streaming route, kept as a Response. */
export const doStream = (
  stub: cf.DurableObjectStub,
  path: string,
  headers: Record<string, string>,
): Effect.Effect<Response, ChatUnavailable> =>
  Effect.gen(function* () {
    const observation = yield* chatObservationHeaders;
    return yield* Effect.tryPromise({
      try: async () => {
        const response: unknown = await stub.fetch(`https://chat.internal${path}`, {
          method: "GET",
          headers: { accept: "text/event-stream", ...callerHeaders(headers), ...observation },
        });
        if (!(response instanceof Response)) throw new Error("Chat object returned a non-Response");
        return response;
      },
      catch: (error) => withCause(new ChatUnavailable(), error),
    });
  });
