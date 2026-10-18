/**
 * Owner-scoped R2 object layout and responses.
 *
 * The prefix scope is the owner catalog Durable Object id, so two owners that
 * create the same chat or file UUID cannot collide in the bucket. Staging
 * objects are uncommitted and swept explicitly; retained objects are accepted
 * originals. Keys never leave server code.
 */
import type * as cf from "@cloudflare/workers-types";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
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
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  await bucket.put(key, body.buffer, {
    httpMetadata: { contentType: metadata.contentType, cacheControl: "no-store" },
    customMetadata: {
      fileId: metadata.fileId,
      chatId: metadata.chatId,
      digest: metadata.digest,
      name: metadata.name,
    },
  });
};

export const readStoredObject = async (
  bucket: cf.R2Bucket,
  key: string,
): Promise<Uint8Array | null> => {
  const object = await bucket.get(key);
  return object === null ? null : object.bytes();
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

/** Server-side copy to the retained prefix; idempotent when the copy already exists. */
export const copyToRetained = async (
  bucket: cf.R2Bucket,
  fromKey: string,
  toKey: string,
): Promise<boolean> => {
  if ((await bucket.head(toKey)) !== null) return true;
  const source = await bucket.get(fromKey);
  if (source === null) return false;
  return await bucket
    .put(toKey, source.body, {
      httpMetadata: {
        contentType: source.httpMetadata?.contentType ?? "application/octet-stream",
        cacheControl: "no-store",
      },
      customMetadata: { ...source.customMetadata },
    })
    .then(() => true)
    .catch(() => false);
};

/** Byte operations for the sweep and retain jobs over one private bucket. */
export const chatFilesObjectStore = (bucket: cf.R2Bucket): ChatFilesObjectStore => ({
  delete: (keys) => deleteStoredObjects(bucket, keys),
  copy: (from, to) => copyToRetained(bucket, from, to),
});

const ASCII_SAFE = /[^A-Za-z0-9._-]/g;
const asciiName = (name: string): string => {
  const cleaned = name.replace(ASCII_SAFE, "_").slice(0, 64);
  return cleaned.length === 0 ? "file" : cleaned;
};

/** RFC 5987 value; `encodeURIComponent` leaves `'()*` unescaped. */
const encodedName = (name: string): string =>
  encodeURIComponent(name).replace(/['()*]/g, (character) => {
    const code = character.charCodeAt(0).toString(16).toUpperCase();
    return `%${code}`;
  });

/**
 * Private original response. Originals are never cacheable, never sniffed into
 * another type, and text is forced to a download so active markup can never
 * render on the application origin.
 */
export const originalResponse = (
  request: Request,
  descriptor: FileDescriptor,
  bytes: Uint8Array,
): Response => {
  const image = descriptor.kind === "image";
  const headers = new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "content-disposition":
      `${image ? "inline" : "attachment"}; ` +
      `filename="${asciiName(descriptor.name)}"; filename*=UTF-8''${encodedName(descriptor.name)}`,
    "content-type": image ? descriptor.mediaType : "text/plain; charset=utf-8",
    "content-length": String(bytes.byteLength),
  });
  return new Response(request.method === "HEAD" ? null : bytes, { headers });
};
