import type * as cf from "@cloudflare/workers-types";
import type { ImageStoreContext, Original } from "@abhishek944/pi-image-gen/core";
import { MAX_IMAGE_BYTES } from "./chat-attachment-schema.ts";
import { validateFileBytes } from "./chat-files-media.ts";
import { retainedObjectKey } from "./chat-files-store.ts";
import type { ChatImageStorageLedger } from "./chat-image-storage-ledger.ts";
import {
  type ImageCallKey,
  ImageReceiptExpectation,
  ImageStoreQuery,
  ImageStorageError,
  requireImageValue,
} from "./chat-image-storage-schema.ts";
import type { SavedFile } from "./chat-library-schema.ts";
import type { GeneratedReceipt } from "./chat-generated-storage.ts";

export const generatedDeclaredBytes = (request: Request): number => {
  const raw = request.headers.get("x-image-byte-size") ?? request.headers.get("content-length");
  if (raw === null || !/^[1-9][0-9]{0,7}$/.test(raw)) throw new ImageStorageError("invalid_input");
  const bytes = Number(raw);
  const contentLength = request.headers.get("content-length");
  if (bytes > MAX_IMAGE_BYTES || (contentLength !== null && Number(contentLength) !== bytes))
    throw new ImageStorageError("invalid_output");
  return bytes;
};

type Dependencies = {
  readonly ledger: ChatImageStorageLedger;
  readonly bucket: cf.R2Bucket;
  readonly scope: string;
  readonly receipt: (
    key: ImageCallKey & { index: number },
    expected: ImageReceiptExpectation,
  ) => Promise<GeneratedReceipt>;
};

/** Validate and persist output under the owner's durable storage intent. */
export const persistGeneratedOutput = async (
  deps: Dependencies,
  key: ImageCallKey,
  output: Original,
  index: number,
  context: ImageStoreContext,
): Promise<SavedFile> => {
  const query = requireImageValue(ImageStoreQuery, { ...key, index, total: context.total });
  if (context.signal.aborted) throw new ImageStorageError("not_admitted");
  const buffer = output.bytes.buffer;
  if (!(buffer instanceof ArrayBuffer)) throw new ImageStorageError("invalid_output");
  const bytes = new Uint8Array(buffer, output.bytes.byteOffset, output.bytes.byteLength);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES)
    throw new ImageStorageError("invalid_output");
  const ext = output.mimeType === "image/jpeg" ? "jpg" : output.mimeType.slice(6);
  const name = `image-${index + 1}.${ext}`;
  const validated = await validateFileBytes(name, bytes);
  if (
    !validated.ok ||
    validated.value.kind !== "image" ||
    validated.value.mediaType !== output.mimeType ||
    context.descriptor.index !== index ||
    context.descriptor.bytes !== bytes.byteLength ||
    context.descriptor.mimeType !== output.mimeType
  )
    throw new ImageStorageError("invalid_output");
  const plan = deps.ledger.plan(query, {
    fileId: crypto.randomUUID(),
    chatId: key.chatId,
    kind: "image",
    name,
    mediaType: output.mimeType,
    byteSize: bytes.byteLength,
    digest: validated.value.digest,
    width: validated.value.width,
    height: validated.value.height,
    excerpt: null,
    now: Date.now(),
  });
  // Once intent exists, another invocation only reads its receipt; never rewrites originals.
  if (plan.fresh) {
    const row = plan.row;
    try {
      await deps.bucket.put(retainedObjectKey(deps.scope, key.chatId, row.file_id), bytes, {
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: row.digest,
        httpMetadata: { contentType: row.media_type, cacheControl: "no-store" },
        customMetadata: { fileId: row.file_id, chatId: key.chatId, digest: row.digest },
      });
    } catch {
      // A rejected PUT can still have committed; resolve by HEAD only below.
    }
  }
  const receipt = await deps.receipt(
    { ...key, index },
    requireImageValue(ImageReceiptExpectation, {
      digest: validated.value.digest,
      total: query.total,
      byteSize: bytes.byteLength,
      mediaType: validated.value.mediaType,
    }),
  );
  if (receipt.file === null) throw new ImageStorageError("unresolved");
  return receipt.file;
};
