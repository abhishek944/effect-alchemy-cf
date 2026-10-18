import type * as cf from "@cloudflare/workers-types";
import { type Context, Schema } from "effect";
import type { ChatNamespaces } from "./chat-bindings.ts";
import { SpeechClaimResult } from "./chat-catalog-speech.ts";
import { chatHeader, decodeOption } from "./chat-internal.ts";
import { Chat } from "./chat-model.ts";
import type { SpeechHandlerServices } from "./chat-speech-handler.ts";

const Ok = Schema.Struct({ ok: Schema.Literal(true) });

/** Native response interop, validated at this private RPC boundary. */
export const nativeJson = async <S extends Schema.ConstraintDecoder<unknown>>(
  stub: cf.DurableObjectStub,
  method: string,
  path: string,
  schema: S,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<S["Type"]> => {
  const response = await stub.fetch(`https://chat.internal${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error("Private chat service unavailable");
  const raw: unknown = await response.json();
  const decoded = decodeOption(schema, raw);
  if (decoded === null) throw new Error("Private chat service returned invalid data");
  return decoded;
};

/** Every operation uses the authenticated owner's namespace, not browser identity. */
export const nativeSpeechServices = (
  ns: Context.Service.Shape<typeof ChatNamespaces>,
  ownerId: string,
): SpeechHandlerServices => ({
  requireOwnedChat: async (userId, chatId) => {
    if (userId !== ownerId) return false;
    try {
      const chat = await nativeJson(
        ns.catalog(ownerId),
        "GET",
        `/get?id=${encodeURIComponent(chatId)}`,
        Chat,
      );
      return chat.id === chatId;
    } catch {
      return false;
    }
  },
  claimOperation: async (input) => {
    if (input.userId !== ownerId) return { ok: false, code: "unavailable" };
    return nativeJson(ns.catalog(ownerId), "POST", "/speech/claim", SpeechClaimResult, input);
  },
  settleOperation: async (claimId, outcome) => {
    await nativeJson(ns.catalog(ownerId), "POST", "/speech/settle", Ok, { claimId, outcome });
  },
  recordUsage: async (usage) => {
    if (usage.chatId === null) {
      await nativeJson(ns.catalog(ownerId), "POST", "/usage/speech", Ok, usage);
      return;
    }
    const chat = await nativeJson(ns.catalog(ownerId), "GET", `/get?id=${usage.chatId}`, Chat);
    await nativeJson(
      ns.conversation(ownerId, chat.id),
      "POST",
      "/usage/speech",
      Ok,
      usage,
      chatHeader(chat),
    );
  },
});
