/** Legacy inline preparation retains its1.75MiB native row ceiling, without resizing.
 * New sends use compact image-input preparation and request-only hydration instead.
 */
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { UserInput } from "@earendil-works/pi-durable";
import type * as cf from "@cloudflare/workers-types";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_EXCERPT_CHARS,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_QUOTED_TEXT_CHARS,
  type FileDescriptor,
} from "./chat-attachment-schema.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import type { ChatFilesPrepareResult } from "./chat-files-ops.ts";
import {
  filesFail,
  filesOk,
  MAX_NATIVE_SERIALIZED_BYTES,
  type ChatFilesResult,
} from "./chat-files-model.ts";
import { readOwnedOriginal } from "./chat-files-store.ts";
import {
  attachmentBoundary,
  decodeTextFile,
  officeAttachmentBlock,
  quotedAttachmentBlock,
} from "./chat-files-text.ts";
import { csvReferenceBlock, isCsvOriginal } from "./chat-image-hydration-csv.ts";
import {
  chatFilesImageCompatibility,
  imageBase64Bytes as base64Bytes,
} from "./chat-files-image-policy.ts";
export { chatFilesImageCompatibility } from "./chat-files-image-policy.ts";

export type NativeContent = {
  readonly content: UserInput;
  readonly files: readonly FileDescriptor[];
};

export type NativeAttachment = {
  readonly file: FileDescriptor;
};

const base64Of = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

/** Owned original bytes become native input; Office contributes compact refs only. */
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
  const textTotal = files.filter((file) => file.kind === "text" && !isCsvOriginal(file)).length;
  const csvTotal = files.filter(isCsvOriginal).length;
  const officeTotal = files.filter((file) => file.kind === "office").length;
  let quotedChars = 0;
  let textIndex = 0;
  let csvIndex = 0;
  let officeIndex = 0;
  for (const attachment of input.attachments) {
    if (attachment.file.kind === "office") {
      blocks.push({
        type: "text",
        text: officeAttachmentBlock({
          boundary,
          index: officeIndex,
          total: officeTotal,
          fileRef: attachment.file.id,
          name: attachment.file.name,
          mediaType: attachment.file.mediaType,
          byteSize: attachment.file.byteSize,
        }),
      });
      officeIndex += 1;
      continue;
    }
    if (isCsvOriginal(attachment.file)) {
      blocks.push({
        type: "text",
        text: csvReferenceBlock(attachment.file, boundary, csvIndex, csvTotal),
      });
      csvIndex += 1;
      continue;
    }
    const bytes = await input.read(attachment.file.id);
    if (bytes === null || bytes.byteLength !== attachment.file.byteSize)
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
  const attachments: NativeAttachment[] = prepared.value.files.map((file) => ({ file }));
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
