import type { FileDescriptor } from "./chat-attachment-schema.ts";
import {
  MAX_MESSAGE_ATTACHMENT_BYTES,
  FileDescriptor as Descriptor,
} from "./chat-attachment-schema.ts";
import { Option, Schema } from "effect";
import type { ChatFilesCatalogClient } from "./chat-files-client.ts";
import { chatFilesImageCompatibility } from "./chat-files-native.ts";
import { createChatLibraryClient } from "./chat-library-client.ts";
import type { ChatCatalogStub } from "./chat-bindings.ts";
import { ImageOriginalBinding } from "./chat-image-response-schema.ts";
import { responseValue } from "./chat-image-response-codec.ts";
import { ImageInputError, type ImageInputRequest } from "./chat-image-input-types.ts";

export type ImageInputFiles = {
  readonly files: readonly FileDescriptor[];
  readonly originals: readonly ImageOriginalBinding[];
  readonly uploadIds: readonly string[];
};

function descriptor(raw: FileDescriptor, chatId: string, fileId: string): FileDescriptor {
  const file = Option.getOrNull(Schema.decodeUnknownOption(Descriptor)(raw));
  if (
    file === null ||
    file.chatId !== chatId ||
    file.id !== fileId ||
    file.state !== "ready" ||
    file.expiresAt !== null
  )
    throw new ImageInputError("unavailable");
  return file;
}

function binding(
  file: FileDescriptor,
  digest: string,
  creator: string | null,
  origin: string,
  existing?: ImageOriginalBinding,
): ImageOriginalBinding {
  const original = responseValue(ImageOriginalBinding, {
    fileId: file.id,
    digest,
    url: existing?.url ?? new URL(`/api/chats/${file.chatId}/attachments/${file.id}`, origin).href,
    originOperationId: creator,
    kind: file.kind,
    name: file.name,
    byteSize: file.byteSize,
    mediaType: file.mediaType,
    width: file.width,
    height: file.height,
  });
  if (existing !== undefined) {
    const prior = responseValue(ImageOriginalBinding, existing);
    if (Object.entries(original).some(([key, value]) => Reflect.get(prior, key) !== value))
      throw new ImageInputError("conflict");
  }
  return original;
}

/** Metadata only: staged IDs keep the upload fence; accepted references never rebind. */
export async function prepareImageInputFiles(
  catalog: ChatFilesCatalogClient,
  stub: ChatCatalogStub,
  input: ImageInputRequest,
  origin: string,
  known?: readonly ImageOriginalBinding[],
  signal?: AbortSignal,
): Promise<ImageInputFiles> {
  const library = createChatLibraryClient(stub);
  const files = new Map<string, FileDescriptor>();
  const originals = new Map<string, ImageOriginalBinding>();
  const uploadIds = input.sources
    .filter((source) => source.source === "upload")
    .map((source) => source.fileId);
  for (const [index, source] of input.sources.entries()) {
    signal?.throwIfAborted();
    if (source.source !== "saved") continue;
    const authority = await library.original(input.chatId, source.fileId);
    signal?.throwIfAborted();
    if (authority === null) throw new ImageInputError("unavailable");
    const file = descriptor(authority.file, input.chatId, source.fileId);
    const existing = known?.[index] ?? source.original;
    files.set(file.id, file);
    originals.set(
      file.id,
      binding(file, authority.digest, authority.originOperationId, origin, existing),
    );
  }
  if (uploadIds.length > 0) {
    const prepared = await catalog.prepare({
      operationId: input.operationId,
      chatId: input.chatId,
      fileIds: uploadIds,
      now: Date.now(),
    });
    signal?.throwIfAborted();
    if (!prepared.ok)
      throw new ImageInputError(prepared.code === "unavailable" ? "unavailable" : "invalid_input");
    if (
      prepared.value.files.length !== uploadIds.length ||
      prepared.value.digests.length !== uploadIds.length ||
      prepared.value.byteSize !==
        prepared.value.files.reduce((total, file) => total + file.byteSize, 0) ||
      prepared.value.hasImage !== prepared.value.files.some((file) => file.kind === "image")
    )
      throw new ImageInputError("corrupt");
    for (const [index, raw] of prepared.value.files.entries()) {
      const fileId = uploadIds[index];
      if (fileId === undefined) throw new ImageInputError("corrupt");
      const file = descriptor(raw, input.chatId, fileId);
      const sourceIndex = input.sources.findIndex((source) => source.fileId === file.id);
      const existing = known?.[sourceIndex] ?? input.sources[sourceIndex]?.original;
      if (existing !== undefined && existing.originOperationId !== input.operationId)
        throw new ImageInputError("conflict");
      files.set(file.id, file);
      originals.set(
        file.id,
        binding(file, prepared.value.digests[index] ?? "", input.operationId, origin, existing),
      );
    }
  }
  const orderedFiles: FileDescriptor[] = [];
  const orderedOriginals: ImageOriginalBinding[] = [];
  for (const source of input.sources) {
    const file = files.get(source.fileId);
    const original = originals.get(source.fileId);
    if (file === undefined || original === undefined) throw new ImageInputError("corrupt");
    orderedFiles.push(Object.freeze(file));
    orderedOriginals.push(Object.freeze(original));
  }
  if (
    orderedFiles.reduce((total, file) => total + file.byteSize, 0) > MAX_MESSAGE_ATTACHMENT_BYTES ||
    !chatFilesImageCompatibility(orderedFiles, input.model).ok
  )
    throw new ImageInputError("invalid_input");
  return { files: orderedFiles, originals: orderedOriginals, uploadIds };
}
