import type { Message, UserMessage } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import type { ContextView } from "./chat-transcript-types.ts";
import type { AcceptedOriginalBinding } from "./chat-accepted-input-schema.ts";

export type ImageContextEvidence =
  | readonly {
      readonly requestIndex: number;
      readonly originals: readonly AcceptedOriginalBinding[];
    }[]
  | null;
export type ReadImageContextEvidence = (view: ContextView) => Promise<ImageContextEvidence>;

/** Accounting-only metadata projection. It never loads private bytes or contacts a provider. */
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
    const images: UserMessage["content"] = occurrence.originals
      .filter((original) => original.kind === "image")
      .map((original) => ({ type: "image", data: "", mimeType: original.mediaType }));
    if (images.length === 0) continue;
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
