import type * as cf from "@cloudflare/workers-types";
import { Schema } from "effect";
import { ChatSelection, DomainUuid } from "./chat-capabilities.ts";
import type { TitleResponse } from "./chat-accounting-model.ts";
import { chatHeader } from "./chat-internal.ts";
import type { Chat } from "./chat-model.ts";

const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Cost = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const NativeUsage = Schema.Struct({
  input: Count,
  output: Count,
  cacheRead: Count,
  cacheWrite: Count,
  cacheWrite1h: Schema.optionalKey(Count),
  reasoning: Schema.optionalKey(Count),
  totalTokens: Count,
  cost: Schema.Struct({
    input: Cost,
    output: Cost,
    cacheRead: Cost,
    cacheWrite: Cost,
    total: Cost,
  }),
});
export const TitleUsageBody = Schema.Struct({
  operationId: DomainUuid,
  selection: ChatSelection,
  response: Schema.NullOr(
    Schema.Struct({
      model: Schema.String.check(Schema.isMaxLength(128)),
      provider: Schema.String.check(Schema.isMaxLength(64)),
      timestamp: Schema.Number,
      stopReason: Schema.Literals([
        "pending",
        "stop",
        "length",
        "toolUse",
        "error",
        "aborted",
        "deferred",
      ]),
      usage: NativeUsage,
    }),
  ),
});

/** No title prose, private thinking or provider payload crosses this accounting seam. */
export const reportTitleUsage = async (input: {
  namespace: cf.DurableObjectNamespace | undefined;
  ownerId: string | undefined;
  chat: Chat | null;
  operationId: string;
  selection: ChatSelection;
  response: TitleResponse | null;
}): Promise<void> => {
  if (input.namespace === undefined || input.ownerId === undefined || input.chat === null)
    throw new Error("Title attribution unavailable");
  const response = input.response;
  const receipt =
    response === null
      ? null
      : {
          model: response.model,
          provider: response.provider,
          timestamp: response.timestamp,
          stopReason: response.stopReason,
          usage: response.usage,
        };
  const result = await input.namespace
    .getByName(`chat:${input.ownerId}:${input.chat.id}`)
    .fetch("https://chat.internal/usage/title", {
      method: "POST",
      headers: { "content-type": "application/json", ...chatHeader(input.chat) },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        operationId: input.operationId,
        selection: input.selection,
        response: receipt,
      }),
    });
  if (!result.ok) throw new Error("Title attribution unavailable");
};
