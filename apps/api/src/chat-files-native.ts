/**
 * Native preparation: real structured text/image content from owned originals.
 *
 * The selected model's installed image metadata is enforced here (no silent
 * resize). Every submission must fit the verified 2 MiB Durable Object SQL row
 * limit, so content is capped at 1.75 MiB serialized with a 0.25 MiB envelope
 * reserve; larger images fail explicitly as `native_storage_limit` while their
 * R2 originals stay retained at the approved product size. Nothing is
 * truncated or downscaled. Text files become quoted untrusted data with a
 * random boundary; images become native base64 image blocks.
 */
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { UserInput } from "@earendil-works/pi-durable";
import type * as cf from "@cloudflare/workers-types";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_EXCERPT_CHARS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_QUOTED_TEXT_CHARS,
  type FileDescriptor,
} from "./chat-attachment-schema.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import type { ChatFilesPrepareResult } from "./chat-files-ops.ts";
import { sha256Hex } from "./chat-files-media.ts";
import {
  filesFail,
  filesOk,
  MAX_NATIVE_SERIALIZED_BYTES,
  type ChatFilesFailure,
  type ChatFilesResult,
} from "./chat-files-model.ts";
import { readOwnedOriginal } from "./chat-files-store.ts";
import { attachmentBoundary, decodeTextFile, quotedAttachmentBlock } from "./chat-files-text.ts";

export type NativeContent = {
  readonly content: UserInput;
  readonly files: readonly FileDescriptor[];
};

export type NativeAttachment = {
  readonly file: FileDescriptor;
  /** Server-side digest for integrity verification; never public. */
  readonly digest: string;
};

const DIGEST = /^[0-9a-f]{64}$/;

const base64Bytes = (raw: number): number => 4 * Math.ceil(raw / 3);

const base64Of = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

const imageFailure = (file: FileDescriptor, model: ChatCatalogModel): ChatFilesFailure | null => {
  if (file.byteSize > MAX_IMAGE_BYTES) return "file_too_large";
  const pixels = (file.width ?? 0) * (file.height ?? 0);
  if (pixels > MAX_IMAGE_PIXELS) return "file_too_large";
  const resize = model.imageResize;
  if (resize === null) return null;
  if ((file.width ?? 0) > resize.maxWidth || (file.height ?? 0) > resize.maxHeight)
    return "model_image_limits";
  return base64Bytes(file.byteSize) > resize.maxBytes ? "model_image_limits" : null;
};
/** Capability check for images already in conversation context and for new files. */
export const chatFilesImageCompatibility = (
  files: readonly FileDescriptor[],
  model: ChatCatalogModel,
): ChatFilesResult<null> => {
  const images = files.filter((file) => file.kind === "image");
  if (images.length > 0 && !model.imageInput) return filesFail("model_image_unsupported");
  for (const file of images) {
    const failure = imageFailure(file, model);
    if (failure !== null) return filesFail(failure);
  }
  return filesOk(null);
};
/** Builds the exact native input; reads originals one at a time and verifies digests. */
export const buildNativeInput = async (input: {
  readonly text: string;
  readonly attachments: readonly NativeAttachment[];
  readonly model: ChatCatalogModel;
  readonly read: (fileId: string) => Promise<Uint8Array | null>;
}): Promise<ChatFilesResult<NativeContent>> => {
  if (input.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) return filesFail("too_many_files");
  const files = input.attachments.map((attachment) => attachment.file);
  if (files.reduce((sum, file) => sum + file.byteSize, 0) > MAX_MESSAGE_ATTACHMENT_BYTES)
    return filesFail("message_too_large");
  const compatibility = chatFilesImageCompatibility(files, input.model);
  if (!compatibility.ok) return filesFail(compatibility.code);
  const estimated = files
    .filter((file) => file.kind === "image")
    .reduce((sum, file) => sum + base64Bytes(file.byteSize), 0);
  if (estimated > MAX_NATIVE_SERIALIZED_BYTES) return filesFail("native_storage_limit");
  const blocks: (TextContent | ImageContent)[] = [];
  if (input.text.length > 0) blocks.push({ type: "text", text: input.text });
  const boundary = attachmentBoundary();
  const textTotal = files.filter((file) => file.kind === "text").length;
  let quotedChars = 0;
  let textIndex = 0;
  for (const attachment of input.attachments) {
    const bytes = await input.read(attachment.file.id);
    if (bytes === null || bytes.byteLength !== attachment.file.byteSize)
      return filesFail("unavailable");
    if (!DIGEST.test(attachment.digest) || (await sha256Hex(bytes)) !== attachment.digest)
      return filesFail("unavailable");
    if (attachment.file.kind === "image") {
      blocks.push({
        type: "image",
        data: base64Of(bytes),
        mimeType: attachment.file.mediaType,
      });
      continue;
    }
    const decoded = decodeTextFile(bytes, MAX_EXCERPT_CHARS);
    if (!decoded.ok) return filesFail("invalid_content");
    quotedChars += decoded.chars;
    if (quotedChars > MAX_QUOTED_TEXT_CHARS) return filesFail("quoted_text_too_large");
    blocks.push({
      type: "text",
      text: quotedAttachmentBlock({
        boundary,
        index: textIndex,
        total: textTotal,
        name: attachment.file.name,
        mediaType: attachment.file.mediaType,
        byteSize: attachment.file.byteSize,
        text: decoded.text,
      }),
    });
    textIndex += 1;
  }
  if (blocks.length === 0) return filesFail("invalid_input");
  const serialized = new TextEncoder().encode(JSON.stringify(blocks)).byteLength;
  if (serialized > MAX_NATIVE_SERIALIZED_BYTES) return filesFail("native_storage_limit");
  return filesOk({ content: blocks, files });
};

export type ChatFilesCatalogPort = {
  readonly prepare: (input: {
    readonly operationId: string;
    readonly chatId: string;
    readonly fileIds: readonly string[];
    readonly now: number;
  }) => Promise<ChatFilesResult<ChatFilesPrepareResult>>;
  readonly release: (input: {
    readonly operationId: string;
    readonly chatId: string;
    readonly now: number;
  }) => Promise<ChatFilesResult<unknown>>;
};
/**
 * Binds staged files to the operation, builds native content from owned
 * originals, and releases the binding on failure so the files stay staged,
 * retryable and removable.
 */
export const prepareChatFiles = async (input: {
  readonly bucket: cf.R2Bucket;
  readonly scope: string;
  readonly catalog: ChatFilesCatalogPort;
  readonly chatId: string;
  readonly operationId: string;
  readonly text: string;
  readonly attachments: readonly string[];
  readonly model: ChatCatalogModel;
  readonly now: number;
}): Promise<ChatFilesResult<NativeContent>> => {
  const prepared = await input.catalog.prepare({
    operationId: input.operationId,
    chatId: input.chatId,
    fileIds: input.attachments,
    now: input.now,
  });
  if (!prepared.ok) return prepared;
  const attachments: NativeAttachment[] = prepared.value.files.map((file, index) => ({
    file,
    digest: prepared.value.digests[index] ?? "",
  }));
  const built = await buildNativeInput({
    text: input.text,
    attachments,
    model: input.model,
    read: (fileId) => readOwnedOriginal(input.bucket, input.scope, input.chatId, fileId),
  });
  if (!built.ok) {
    await input.catalog
      .release({ operationId: input.operationId, chatId: input.chatId, now: input.now })
      .catch(() => undefined);
  }
  return built;
};
