import type { ImageContent, TextContent, UserMessage } from "@earendil-works/pi-ai";
import { MAX_EXCERPT_CHARS, MAX_QUOTED_TEXT_CHARS } from "./chat-attachment-schema.ts";
import { chatFilesImageCompatibility } from "./chat-files-native.ts";
import {
  attachmentBoundary,
  countTextChars,
  decodeTextFile,
  quotedAttachmentBlock,
} from "./chat-files-text.ts";
import { csvReferenceBlock, isCsvOriginal } from "./chat-image-hydration-csv.ts";
import { createChatLibraryClient } from "./chat-library-client.ts";
import type { SavedOriginalMetadata } from "./chat-library-original.ts";
import { readAcceptedOriginal } from "./chat-image-original.ts";
import { runImageIO } from "./chat-image-io.ts";
import { encodeHydrationBase64 } from "./chat-image-hydration-codec.ts";
import { referenceTextSlice } from "./chat-reference-input.ts";
import { originalReferenceSlices } from "./chat-reference-hydration.ts";
import type { HydrationOccurrence, ImageHydrationPlan } from "./chat-image-hydration-plan.ts";
import {
  hydrationFailure,
  hydrationSignal,
  type ImageHydrationInput,
} from "./chat-image-hydration-types.ts";

export type AuthorizedHydrationOccurrence = HydrationOccurrence & {
  readonly originals: readonly SavedOriginalMetadata[];
};

/** Resolve ALL accepted immutable metadata before the first private original byte read. */
export const authorizeHydrationOriginals = async (
  input: ImageHydrationInput,
  plan: ImageHydrationPlan,
): Promise<readonly AuthorizedHydrationOccurrence[]> => {
  if (!plan.occurrences.some((item) => item.occurrence.originals.length > 0))
    return plan.occurrences.map((item) => ({ ...item, originals: [] }));
  const catalog = input.catalog;
  if (catalog === undefined || input.bucket === undefined)
    return hydrationFailure("original_unavailable");
  const client = createChatLibraryClient(catalog);
  const chatId = input.proof.current.candidate.chatId;
  const authorized: AuthorizedHydrationOccurrence[] = [];
  for (const item of plan.occurrences) {
    const originals: SavedOriginalMetadata[] = [];
    for (const binding of item.occurrence.originals) {
      hydrationSignal(input.signal);
      const authority = await runImageIO({
        signal: input.signal,
        run: () => client.original(chatId, binding.fileId),
      });
      if (authority === null) return hydrationFailure("original_unavailable");
      const file = authority.file;
      if (
        file.id !== binding.fileId ||
        file.chatId !== chatId ||
        authority.originOperationId !== binding.originOperationId ||
        file.name !== binding.name ||
        file.kind !== binding.kind ||
        file.byteSize !== binding.byteSize ||
        file.mediaType !== binding.mediaType ||
        file.width !== binding.width ||
        file.height !== binding.height
      )
        return hydrationFailure("metadata_mismatch");
      if (file.state !== "ready" || file.expiresAt !== null)
        return hydrationFailure("original_unavailable");
      const compatibility = chatFilesImageCompatibility([file], input.model);
      if (!compatibility.ok)
        return hydrationFailure(
          compatibility.code === "model_image_unsupported"
            ? "model_image_unsupported"
            : "model_image_limits",
        );
      originals.push(authority);
    }
    authorized.push({ ...item, originals });
  }
  return authorized;
};

/** Caption and timestamp stay exact; new transient attachment blocks follow reference order. */
export const loadHydrationOccurrence = async (
  input: ImageHydrationInput,
  item: AuthorizedHydrationOccurrence,
): Promise<UserMessage> => {
  if (item.originals.length === 0) return item.message;
  const content: (TextContent | ImageContent)[] =
    typeof item.message.content === "string"
      ? [{ type: "text", text: item.message.content }]
      : [...item.message.content];
  const catalog = input.catalog;
  const bucket = input.bucket;
  if (catalog === undefined || bucket === undefined)
    return hydrationFailure("original_unavailable");
  const ownerScope = catalog.id.toString();
  const boundary = attachmentBoundary();
  const selections = new Map(
    item.originals.map((original) => [
      original.file.id,
      originalReferenceSlices(item.occurrence.referenceInputs, original.file.id),
    ]),
  );
  const textTotal = item.originals.reduce(
    (total, original) =>
      total +
      (original.file.kind !== "text"
        ? 0
        : (selections.get(original.file.id)?.length ?? (isCsvOriginal(original.file) ? 0 : 1))),
    0,
  );
  const csvTotal = item.originals.filter(
    (original) => isCsvOriginal(original.file) && selections.get(original.file.id) === undefined,
  ).length;
  let textIndex = 0;
  let csvIndex = 0;
  let quotedChars = 0;
  for (const original of item.originals) {
    hydrationSignal(input.signal);
    const slices = selections.get(original.file.id);
    if (isCsvOriginal(original.file) && slices === undefined) {
      content.push({
        type: "text",
        text: csvReferenceBlock(original.file, boundary, csvIndex, csvTotal, original.digest),
      });
      csvIndex += 1;
      continue;
    }
    const loaded = await readAcceptedOriginal({
      bucket,
      ownerScope,
      chatId: input.proof.current.candidate.chatId,
      metadata: { state: "accepted", ownerScope, file: original.file },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    hydrationSignal(input.signal);
    if (loaded.kind === "image") {
      content.push({
        type: "image",
        data: encodeHydrationBase64(loaded.bytes),
        mimeType: loaded.mimeType,
      });
      continue;
    }
    const decoded = decodeTextFile(loaded.bytes, MAX_EXCERPT_CHARS);
    if (!decoded.ok || decoded.chars !== loaded.textCharacters)
      return hydrationFailure("original_integrity");
    let texts: string[];
    try {
      texts =
        slices === undefined
          ? [decoded.text]
          : slices.map((span) => referenceTextSlice(decoded.text, span));
    } catch {
      return hydrationFailure("invalid_context");
    }
    for (const text of texts) {
      quotedChars += countTextChars(text);
      if (quotedChars > MAX_QUOTED_TEXT_CHARS) hydrationFailure("quoted_text_too_large");
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
  hydrationSignal(input.signal);
  return { ...item.message, content };
};
