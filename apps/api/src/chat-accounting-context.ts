/**
 * Authoritative native context estimate: the committed full model context (not
 * the bounded browser transcript) measured with the SDK's own
 * `estimateContextTokens`, bounded by the installed catalog window for the
 * currently selected model. Recomputed on every read, so a model change
 * invalidates the previous estimate; no provider call is made.
 */
import type { Message } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { installedChatModel } from "./chat-capability-catalog.ts";
import type { ChatSelection } from "./chat-capabilities.ts";
import type { ContextUsage } from "./chat-usage-schema.ts";

export const estimateChatContext = (
  messages: readonly Message[],
  selection: ChatSelection | null,
): ContextUsage => {
  const catalog = selection === null ? null : installedChatModel(selection.model);
  if (selection === null || catalog === null)
    return { provenance: "unknown", model: null, estimatedTokens: null, contextWindow: null };
  return {
    provenance: "estimated",
    model: selection.model,
    estimatedTokens: estimateContextTokens(messages).tokens,
    contextWindow: catalog.contextWindow,
  };
};
