/**
 * Compact image-tool results and fixed failure outcomes.
 *
 * The model receives private file links, never base64, provider URLs, error
 * bodies or credentials. A dispatched or uncertain failure stays honest so the
 * model cannot promise a refund or silently repeat a paid request.
 */
import { ImageCoreError, type ImageMetadata } from "@abhishek944/pi-image-gen/core";
import { Option, Schema } from "effect";
import { ImageCallMetadata } from "./chat-image-call-schema.ts";
import type { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import type { ChatToolResult } from "./chat-sdk-tool.ts";
import type { SavedFile } from "./chat-library-schema.ts";

export type ImageOutcome = {
  readonly dispatched: boolean;
  readonly uncertain: boolean;
  readonly storageUncertain: boolean;
  readonly partial: boolean;
};

export type ImageReceiptState = {
  readonly dispatched: boolean;
  readonly storing: boolean;
  readonly files: ReadonlyMap<number, SavedFile>;
  readonly metadata?: ImageMetadata | undefined;
};

export const imageFileEntries = (state: Pick<ImageReceiptState, "files">) =>
  [...state.files]
    .toSorted(([left], [right]) => left - right)
    .map(([index, file]) => ({ index, file }));

export const imageFiles = (state: Pick<ImageReceiptState, "files">) =>
  imageFileEntries(state).map((entry) => entry.file);

/** One bounded metadata object per provider request; never a raw body. */
export const rememberImageMetadata = (metadata: ImageMetadata): ImageMetadata | null =>
  Option.getOrNull(Schema.decodeUnknownOption(ImageCallMetadata)(metadata));

export const safeImageError = (
  error: unknown,
  state: ImageReceiptState,
): { readonly outcome: ImageOutcome; readonly metadata?: ImageMetadata } => {
  const core = error instanceof ImageCoreError ? error : undefined;
  const metadata =
    core === undefined ? state.metadata : (rememberImageMetadata(core.metadata) ?? state.metadata);
  const dispatched = state.dispatched;
  return {
    outcome: {
      dispatched,
      uncertain: dispatched && (core?.outcome.uncertain ?? metadata === undefined),
      storageUncertain: dispatched && state.storing && (core?.outcome.storageUncertain ?? true),
      partial: dispatched && (state.files.size > 0 || core?.outcome.partial === true),
    },
    ...(dispatched && metadata !== undefined ? { metadata } : {}),
  };
};

export const imageToolResult = (
  candidate: ImageResponseCandidate | undefined,
  files: readonly SavedFile[],
  outcome: ImageOutcome | undefined,
  message: string,
  isError: boolean,
): ChatToolResult => {
  const links = files.map((file) => {
    if (candidate === undefined) return file.id;
    const url = `${candidate.applicationOrigin}/api/chats/${file.chatId}/attachments/${file.id}`;
    return `${file.state === "unavailable" ? "Unavailable saved image" : "Saved image"}: ${url}`;
  });
  return {
    isError,
    content: [{ type: "text", text: [message, ...links].join("\n") }],
    details: {
      ...(outcome === undefined
        ? {}
        : {
            dispatched: outcome.dispatched,
            uncertain: outcome.uncertain,
            storageUncertain: outcome.storageUncertain,
            partial: outcome.partial,
          }),
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        mediaType: file.mediaType,
        byteSize: file.byteSize,
        width: file.width,
        height: file.height,
      })),
    },
  };
};
