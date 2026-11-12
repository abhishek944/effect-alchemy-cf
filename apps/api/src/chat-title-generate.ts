import { createModels } from "@earendil-works/pi-ai/models";
import type { Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { configuredChatProvider } from "./chat-model-transport.ts";
import { gatewayCatalogSnapshot } from "./chat-gateway-catalog.ts";
import { attributedPayload } from "./chat-gateway-identity.ts";
import { titleTracing } from "./chat-tracing.ts";
import { TITLE_MAX_TOKENS } from "./chat-title-policy.ts";
import {
  reportTitleFailure,
  sanitizeTitle,
  TITLE_INSTRUCTIONS,
  type ChatTitleNamer,
} from "./chat-title.ts";

/** Existing bounded independent title call; exact selected model/effort, no retry or fallback. */
export const makeChatTitleNamer = (
  env: Readonly<Record<string, unknown>>,
): ChatTitleNamer | null => {
  const provider = configuredChatProvider(env);
  if (provider === null) return null;
  const models = createModels();
  models.setProvider(provider);
  return async (text, selection, recordUsage, identity) => {
    if (!text.trim() || !gatewayCatalogSnapshot().ids.includes(selection.model)) return null;
    const model = models.getModel(selection.provider, selection.model);
    if (model === undefined) return null;
    try {
      await recordUsage(null, selection);
    } catch (error) {
      reportTitleFailure(error, "title.usage", "title_usage_claim_failed", { phase: "claim" });
      return null;
    }
    const options: SimpleStreamOptions = {
      maxTokens: TITLE_MAX_TOKENS,
      maxRetries: 0,
      signal: AbortSignal.timeout(10_000),
      headers: { "x-litellm-customer-id": identity.userId },
      onPayload: (payload) => attributedPayload(payload, identity.userId, model.api),
      thinkingBudgets: { minimal: 1024, low: 1024, medium: 1024, high: 1024 },
      ...(selection.effort === "off" ? {} : { reasoning: selection.effort }),
    };
    const context: Context = {
      systemPrompt: TITLE_INSTRUCTIONS,
      messages: [
        { role: "user", content: Array.from(text).slice(0, 2000).join(""), timestamp: Date.now() },
      ],
    };
    const observation = titleTracing.generation(
      { model: model.id, provider: "litellm" },
      {
        ...identity,
        traceName: "chat.title",
        tags: ["title"],
      },
    );
    try {
      const message = await models.completeSimple(model, context, options);
      observation.end({
        outcome:
          message.stopReason === "error"
            ? "error"
            : message.stopReason === "aborted"
              ? "aborted"
              : "completed",
        usage: message.usage,
        ...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
      });
      try {
        await recordUsage(message, selection);
      } catch (error) {
        reportTitleFailure(error, "title.usage", "title_usage_record_failed", { phase: "record" });
      }
      if (message.stopReason !== "stop") return null;
      return sanitizeTitle(
        message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" "),
      );
    } catch {
      observation.end({ outcome: "error" });
      throw new Error("Title generation unavailable");
    }
  };
};
