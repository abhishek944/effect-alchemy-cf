import type { Message, UserMessage } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import type { ContextView } from "@earendil-works/pi-durable";
import { mapImageInputOccurrences } from "./chat-image-request-occurrences.ts";
import type {
  ImageNativeContext,
  ImageRequestAccess,
  InputOccurrence,
} from "./chat-image-request-types.ts";

/** Null is unavailable evidence, not proof that the active context has no originals. */
export type ImageContextEvidence = readonly InputOccurrence[] | null;
export type ReadImageContextEvidence = (view: ContextView) => Promise<ImageContextEvidence>;

/** Use the same exact active contributions and accepted joins as the final request bridge. */
export const readImageContextEvidence = async (
  access: ImageRequestAccess,
  view: ContextView,
  context: ImageNativeContext,
): Promise<ImageContextEvidence> => {
  try {
    return await mapImageInputOccurrences(access, access.conversationId, view, context);
  } catch {
    return null;
  }
};

/**
 * Accounting-only projection: no bytes, provider calls, mutation or transport context.
 * Empty image data marks proven image presence for the installed SDK estimator.
 * Text byte length cannot prove decoded character count: an uncovered text original
 * therefore makes Context Unknown instead of estimating its tiny descriptor.
 * Applicable provider usage still covers its measured prefix without replacement.
 */
export const imageContextEstimateMessages = (
  messages: readonly Message[],
  evidence: ImageContextEvidence,
): readonly Message[] | null => {
  if (evidence === null) return null;
  const coverage = estimateContextTokens(messages).lastUsageIndex ?? -1;
  const projected = [...messages];
  const seen = new Set<number>();
  for (const occurrence of evidence) {
    const index = occurrence.requestIndex;
    if (!Number.isSafeInteger(index) || index < 0 || seen.has(index)) return null;
    seen.add(index);
    const message = projected[index];
    if (message?.role !== "user") return null;
    if (index <= coverage || occurrence.originals.length === 0) continue;
    if (occurrence.originals.some((original) => original.kind === "text")) return null;
    const provenImages = occurrence.originals.filter((original) => original.kind === "image");
    if (provenImages.length === 0) continue;
    const images: UserMessage["content"] = provenImages.map((original) => ({
      type: "image",
      data: "",
      mimeType: original.mediaType,
    }));
    projected[index] = {
      ...message,
      content: [
        ...(typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content),
        ...images,
      ],
    };
  }
  return projected;
};
