import type * as cf from "@cloudflare/workers-types";
import { FileMediaType, type FileDescriptor, type FileKind } from "./chat-attachment-schema.ts";
import { isOfficeMediaType } from "./chat-office-media.ts";
import { decodeOption } from "./chat-internal.ts";
import { collectFileBody, holdFileBody } from "./chat-file-io-body.ts";
import { ChatFileIOUnavailable, fileByteLimit, withFileMemory } from "./chat-file-io-memory.ts";

// Worker runtime global; the infra compiler must not need Worker ambient declarations.
declare const FixedLengthStream: typeof cf.FixedLengthStream;

export const fileObjectKind = (object: cf.R2Object, expected?: FileDescriptor): FileKind => {
  const media = decodeOption(FileMediaType, object.httpMetadata?.contentType);
  if (media === null) throw new ChatFileIOUnavailable();
  const kind = media.startsWith("image/") ? "image" : isOfficeMediaType(media) ? "office" : "text";
  if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > fileByteLimit(kind))
    throw new ChatFileIOUnavailable();
  if (
    expected !== undefined &&
    (object.size !== expected.byteSize ||
      media !== expected.mediaType ||
      kind !== expected.kind ||
      (object.customMetadata?.fileId !== undefined &&
        object.customMetadata.fileId !== expected.id) ||
      (object.customMetadata?.chatId !== undefined &&
        object.customMetadata.chatId !== expected.chatId))
  )
    throw new ChatFileIOUnavailable();
  return kind;
};

/** HEAD only: missing permits stage-first fallback; corrupt metadata never silently substitutes. */
export const statFileObject = async (
  bucket: cf.R2Bucket,
  key: string,
  expected?: FileDescriptor,
): Promise<cf.R2Object | null> => {
  const head = await bucket.head(key).catch(() => {
    throw new ChatFileIOUnavailable();
  });
  if (head !== null) fileObjectKind(head, expected);
  return head;
};

/** Call only inside a claimed lease. Recheck size/type/etag after the metadata preflight. */
export const openFileObject = async (
  bucket: cf.R2Bucket,
  key: string,
  head: cf.R2Object,
  expected?: FileDescriptor,
): Promise<cf.R2ObjectBody | null> => {
  const object = await bucket.get(key).catch(() => {
    throw new ChatFileIOUnavailable();
  });
  if (object === null) return null;
  try {
    fileObjectKind(object, expected);
    if (object.size !== head.size || object.etag !== head.etag) throw new ChatFileIOUnavailable();
    return object;
  } catch {
    await object.body.cancel().catch(() => undefined);
    throw new ChatFileIOUnavailable();
  }
};

/** Compatible legacy byte getter. Later hashing/encoding needs the caller's continuing lease. */
export const readFileObjectBytes = async (
  bucket: cf.R2Bucket,
  key: string,
): Promise<Uint8Array | null> => {
  const head = await statFileObject(bucket, key);
  if (head === null) return null;
  return withFileMemory(fileObjectKind(head), head.size, async (lease) => {
    const object = await openFileObject(bucket, key, head);
    if (object === null) return null;
    const held = await holdFileBody(object.body, head.size, lease);
    try {
      return await collectFileBody(held.body);
    } finally {
      await held.cancel();
    }
  });
};

/** Keep retained-copy recovery streaming; never materialize originals merely to copy them. */
export const copyFileObject = async (
  bucket: cf.R2Bucket,
  fromKey: string,
  toKey: string,
): Promise<boolean> => {
  try {
    if ((await statFileObject(bucket, toKey)) !== null) return true;
    const head = await statFileObject(bucket, fromKey);
    if (head === null) return false;
    return await withFileMemory(fileObjectKind(head), head.size, async (lease) => {
      const source = await openFileObject(bucket, fromKey, head);
      if (source === null) return false;
      const held = await holdFileBody(source.body, head.size, lease);
      try {
        // R2 requires a known-length stream. Keep the checked pipeline streaming, not buffered.
        const fixed = new FixedLengthStream(head.size);
        const controller = new AbortController();
        const pumping = held.body.pipeTo(fixed.writable, { signal: controller.signal });
        const writing = Promise.resolve().then(() =>
          bucket.put(toKey, fixed.readable, {
            httpMetadata: {
              contentType: source.httpMetadata?.contentType ?? "application/octet-stream",
              cacheControl: "no-store",
            },
            customMetadata: { ...source.customMetadata },
          }),
        );
        void writing.catch(() => controller.abort());
        const outcomes = await Promise.allSettled([writing, pumping]);
        await held.cancel();
        return outcomes.every((outcome) => outcome.status === "fulfilled") && (await held.done);
      } finally {
        await held.cancel();
      }
    });
  } catch {
    return false;
  }
};
