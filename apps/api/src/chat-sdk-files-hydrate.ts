/**
 * Final model-request hydration for accepted compact chat files.
 *
 * The parent maps each accepted context user message to its stored candidate.
 * Every message shape and compact digest is verified before any original byte is
 * read, so a rewritten or mismatched transcript cannot fetch another file. Only
 * this request receives transient image bytes and quoted text; persisted history
 * stays compact and no base64 enters the transcript.
 */
import type { Context } from "@earendil-works/pi-ai";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { effectiveGenerationOutputTokens } from "./chat-generation-output-budget.ts";
import {
  checkLegacyHydrationImage,
  legacyHydrationByteSize,
} from "./chat-image-hydration-codec.ts";
import {
  ImageHydrationError,
  hydrationError,
  hydrationSignal,
} from "./chat-image-hydration-types.ts";
import { loadAcceptedMessage } from "./chat-sdk-files-load.ts";
import { authorizeAcceptedMessages } from "./chat-sdk-files-originals.ts";
import { chatSdkOwner } from "./chat-sdk-files-types.ts";
import type { ChatSdkFilesDeps } from "./chat-sdk-files-types.ts";

const legacyImages = (context: Context, model: ChatCatalogModel): void => {
  for (const message of context.messages) {
    if (message.role !== "user" && message.role !== "toolResult") continue;
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== "image") continue;
      const byteSize = legacyHydrationByteSize(block, model);
      checkLegacyHydrationImage(block, byteSize, model);
    }
  }
};

export const createChatSdkHydration =
  (deps: ChatSdkFilesDeps) =>
  async (context: Context, model: ChatCatalogModel, signal?: AbortSignal): Promise<Context> => {
    try {
      hydrationSignal(signal);
      const accepted = deps.acceptedFor(context);
      if (accepted.length === 0) {
        legacyImages(context, model);
        return context;
      }
      const authorized = await authorizeAcceptedMessages({
        deps,
        accepted,
        messages: context.messages,
        model,
        ...(signal === undefined ? {} : { signal }),
      });
      const owner = chatSdkOwner(deps);
      if (owner === null) throw new ImageHydrationError("invalid_context");
      const ownerScope = deps.catalog(owner).id.toString();
      legacyImages(context, model);
      const messages = [...context.messages];
      for (const item of authorized) {
        hydrationSignal(signal);
        messages[item.requestIndex] = await loadAcceptedMessage({
          deps,
          ownerScope,
          authorized: item,
          ...(signal === undefined ? {} : { signal }),
        });
      }
      const hydrated = { ...context, messages };
      // Actual selected-model capacity only; no app-side context/image/RAM estimate.
      try {
        effectiveGenerationOutputTokens(model.contextWindow, model.maxOutputTokens, hydrated);
      } catch {
        throw new ImageHydrationError("context_budget");
      }
      hydrationSignal(signal);
      return hydrated;
    } catch (error) {
      throw hydrationError(error, signal);
    }
  };
