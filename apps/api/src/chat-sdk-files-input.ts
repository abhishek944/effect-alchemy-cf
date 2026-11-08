/**
 * Shared input validation for compact file preparation.
 *
 * These are pure structural checks over the authenticated send and the frozen
 * candidate; no original bytes, model text or browser-selected owner participate.
 */
import type { ChatReferenceInputs } from "@highchat/chat-contract";
import { AttachmentReferences } from "./chat-attachment-schema.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { ImageInputError } from "./chat-image-input-types.ts";
import type { ImageInputRequest, ImageInputSource } from "./chat-image-input-types.ts";
import { ImageResponseError } from "./chat-image-response-codec.ts";
import type { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import { ChatSdkFilesError } from "./chat-sdk-files-types.ts";
import type { ChatSdkFilesErrorCode, ChatSdkInput } from "./chat-sdk-files-types.ts";
import { requireReferenceCaption, sameReferenceInputs } from "./chat-reference-input.ts";
import { ImageApplicationOrigin, ImageResponseDigest } from "./chat-image-response-schema.ts";
import { responseValue } from "./chat-image-response-codec.ts";

export function fail(code: ChatSdkFilesErrorCode): never {
  throw new ChatSdkFilesError(code);
}

export const sourcesFor = (input: ChatSdkInput): readonly ImageInputSource[] => {
  const uploads = input.attachments.map((fileId) => ({ source: "upload" as const, fileId }));
  const saved = [
    ...new Set([
      ...(input.references ?? []),
      ...(input.referenceInputs ?? []).flatMap((ref) =>
        ref.kind === "original" ? [ref.fileId] : [],
      ),
    ]),
  ].map((fileId) => ({ source: "saved" as const, fileId }));
  return [...uploads, ...saved];
};

export const translated = (error: unknown, signal?: AbortSignal): ChatSdkFilesError => {
  if (signal?.aborted) return new ChatSdkFilesError("cancelled");
  if (error instanceof ChatSdkFilesError) return error;
  if (error instanceof ImageInputError)
    return new ChatSdkFilesError(
      error.code === "gate_open" || error.code === "queued" ? "gate" : error.code,
    );
  if (error instanceof ImageResponseError)
    return new ChatSdkFilesError(
      error.code === "invalid_input"
        ? "invalid_input"
        : error.code === "conflict"
          ? "conflict"
          : "unavailable",
    );
  return new ChatSdkFilesError("unavailable");
};

export const requireKnown = (input: {
  readonly candidate: ImageResponseCandidate;
  readonly ownerId: string;
  readonly chatId: string;
  readonly chatScope: string;
  readonly conversationId: string;
  readonly identityHash: string;
  readonly referenceInputs: ChatReferenceInputs | undefined;
  readonly sources: readonly ImageInputSource[];
}): void => {
  const known = input.candidate;
  if (
    known.ownerId !== input.ownerId ||
    known.chatId !== input.chatId ||
    known.chatScope !== input.chatScope ||
    known.conversationId !== input.conversationId ||
    known.identityHash !== input.identityHash ||
    !sameReferenceInputs(known.referenceInputs, input.referenceInputs) ||
    known.originals.length !== input.sources.length ||
    known.originals.some((file, index) => file.fileId !== input.sources[index]?.fileId)
  )
    fail("conflict");
};

/** Mirrors the retired preparation guard without any native access or owner inference. */
export const requireRequest = (request: ImageInputRequest): void => {
  responseValue(ImageApplicationOrigin, request.applicationOrigin);
  responseValue(DomainUuid, request.chatId);
  responseValue(DomainUuid, request.operationId);
  responseValue(ImageResponseDigest, request.identityHash);
  responseValue(
    AttachmentReferences,
    request.sources.map((source) => source.fileId),
  );
  requireReferenceCaption(request.text, request.referenceInputs ?? []);
  if (
    request.text !== request.text.trim() ||
    (request.text.length === 0 && request.sources.length === 0) ||
    request.sources.some((source) => source.source !== "upload" && source.source !== "saved")
  )
    fail("invalid_input");
};
