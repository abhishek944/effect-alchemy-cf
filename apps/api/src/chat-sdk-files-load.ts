/**
 * Load already-authorized originals for one final model request.
 *
 * Caption and timestamp stay exact. Images become transient blocks and text
 * becomes quoted untrusted data at the exact stored UTF-16 slices. Nothing here
 * is persisted, so no base64 or complete file body enters the transcript.
 */
import type { ImageContent, TextContent, UserMessage } from "@earendil-works/pi-ai";
import { MAX_EXCERPT_CHARS } from "./chat-attachment-schema.ts";
import { attachmentBoundary, decodeTextFile, quotedAttachmentBlock } from "./chat-files-text.ts";
import { encodeHydrationBase64 } from "./chat-image-hydration-codec.ts";
import { ImageHydrationError, hydrationSignal } from "./chat-image-hydration-types.ts";
import { readAcceptedOriginal } from "./chat-image-original.ts";
import type { ChatSdkFilesDeps } from "./chat-sdk-files-types.ts";
import type { AuthorizedMessage } from "./chat-sdk-files-originals.ts";
import { originalReferenceSlices } from "./chat-reference-hydration.ts";
import { referenceTextSlice } from "./chat-reference-input.ts";

export type OriginalLoad = {
  readonly deps: ChatSdkFilesDeps;
  readonly ownerScope: string;
  readonly authorized: AuthorizedMessage;
  readonly signal?: AbortSignal | undefined;
};

/** Images follow reference order; office metadata is never read as content. */
export const loadAcceptedMessage = async (input: OriginalLoad): Promise<UserMessage> => {
  const { authorized, signal } = input;
  if (authorized.originals.length === 0) return authorized.message;
  const message = authorized.message;
  const content: (TextContent | ImageContent)[] =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : [...message.content];
  const boundary = attachmentBoundary();
  const selections = new Map(
    authorized.originals.map((original) => [
      original.file.id,
      originalReferenceSlices(authorized.candidate.referenceInputs, original.file.id),
    ]),
  );
  const textTotal = authorized.originals.reduce(
    (total, original) =>
      total + (original.file.kind !== "text" ? 0 : (selections.get(original.file.id)?.length ?? 1)),
    0,
  );
  let textIndex = 0;
  for (const original of authorized.originals) {
    hydrationSignal(signal);
    const loaded = await readAcceptedOriginal({
      bucket: input.deps.bucket,
      ownerScope: input.ownerScope,
      chatId: authorized.candidate.chatId,
      metadata: { state: "accepted", ownerScope: input.ownerScope, file: original.file },
      ...(signal === undefined ? {} : { signal }),
    });
    hydrationSignal(signal);
    if (loaded.kind === "image") {
      content.push({
        type: "image",
        data: encodeHydrationBase64(loaded.bytes),
        mimeType: loaded.mimeType,
      });
      continue;
    }
    const decoded = decodeTextFile(loaded.bytes, MAX_EXCERPT_CHARS);
    if (!decoded.ok) throw new ImageHydrationError("original_integrity");
    if (decoded.chars !== loaded.textCharacters)
      throw new ImageHydrationError("original_integrity");
    const slices = selections.get(original.file.id);
    const texts = (() => {
      try {
        return slices === undefined
          ? [decoded.text]
          : slices.map((span) => referenceTextSlice(decoded.text, span));
      } catch {
        throw new ImageHydrationError("invalid_context");
      }
    })();
    for (const text of texts) {
      content.push({
        type: "text",
        text: quotedAttachmentBlock({
          boundary,
          index: textIndex++,
          total: textTotal,
          name: original.file.name,
          mediaType: original.file.mediaType,
          byteSize: original.file.byteSize,
          text,
        }),
      });
    }
  }
  return { ...message, content };
};
