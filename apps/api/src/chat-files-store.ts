/**
 * Owner-scoped R2 object layout and responses.
 *
 * The prefix scope is the owner catalog Durable Object id, so two owners that
 * create the same chat or file UUID cannot collide in the bucket. Staging
 * objects are uncommitted and swept explicitly; retained objects are accepted
 * originals. Keys never leave server code.
 */
import type * as cf from "@cloudflare/workers-types";
import { ChatFileIOUnavailable } from "./chat-file-io-memory.ts";
import {
  readFileObjectBytes as readStoredObject,
  copyFileObject as copyToRetained,
} from "./chat-file-io-objects.ts";
export { readStoredObject, copyToRetained };
export { originalResponse } from "./chat-file-io-response.ts";
import type { ChatFilesObjectStore } from "./chat-files-model.ts";

export const CHAT_FILES_BINDING = "CHAT_FILES";

/** Stable owner isolation derived from the real owner actor, never a browser claim. */
export const chatFilesObjectScope = (stub: cf.DurableObjectStub): string => stub.id.toString();

const keyFor = (prefix: string, scope: string, chatId: string, fileId: string): string =>
  `${prefix}/${scope}/${chatId}/${fileId}`;

export const stagingObjectKey = (scope: string, chatId: string, fileId: string): string =>
  keyFor("stage", scope, chatId, fileId);

export const retainedObjectKey = (scope: string, chatId: string, fileId: string): string =>
  keyFor("retain", scope, chatId, fileId);

export type StagedMetadata = {
  readonly contentType: string;
  readonly fileId: string;
  readonly chatId: string;
  readonly name: string;
  readonly digest: string;
};

export const putStagedObject = async (
  bucket: cf.R2Bucket,
  key: string,
  bytes: Uint8Array,
  metadata: StagedMetadata,
): Promise<void> => {
  const buffer = bytes.buffer;
  if (!(buffer instanceof ArrayBuffer)) throw new ChatFileIOUnavailable();
  const body = new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength);
  await bucket.put(key, body, {
    sha256: metadata.digest,
    httpMetadata: { contentType: metadata.contentType, cacheControl: "no-store" },
    customMetadata: {
      fileId: metadata.fileId,
      chatId: metadata.chatId,
      digest: metadata.digest,
      name: metadata.name,
    },
  });
};

/** Reads an owned original by server-derived keys, staging first then retained. */
export const readOwnedOriginal = async (
  bucket: cf.R2Bucket,
  scope: string,
  chatId: string,
  fileId: string,
): Promise<Uint8Array | null> => {
  const staged = await readStoredObject(bucket, stagingObjectKey(scope, chatId, fileId));
  if (staged !== null) return staged;
  return await readStoredObject(bucket, retainedObjectKey(scope, chatId, fileId));
};

export const deleteStoredObjects = async (
  bucket: cf.R2Bucket,
  keys: readonly string[],
): Promise<void> => {
  if (keys.length === 0) return;
  await bucket.delete([...keys]);
};

/** Byte operations for the sweep and retain jobs over one private bucket. */
export const chatFilesObjectStore = (bucket: cf.R2Bucket): ChatFilesObjectStore => ({
  delete: (keys) => deleteStoredObjects(bucket, keys),
  copy: (from, to) => copyToRetained(bucket, from, to),
});
