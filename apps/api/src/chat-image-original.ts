import type * as cf from "@cloudflare/workers-types";
import { Option, Schema } from "effect";
import { FileDescriptor } from "./chat-attachment-schema.ts";
import { inspectFileBytes } from "./chat-files-media.ts";
import { retainedObjectKey } from "./chat-files-store.ts";
import { checkImageIOSignal, ImageIOError } from "./chat-image-io-error.ts";
import { disposeImageStream, readImageStream } from "./chat-image-io-stream.ts";
import { runImageIO, type ImageIOTracker } from "./chat-image-io.ts";

/**
 * Trusted SERVER result after the owner catalog proved accepted asset identity.
 * `state` is an attestation by that caller, NOT authorization parsed from a public
 * descriptor/model URL. Never construct this from browser input or ready uploads.
 */
export type AcceptedOriginalMetadata = {
  readonly state: "accepted";
  readonly ownerScope: string;
  readonly file: FileDescriptor;
};

export type AcceptedOriginalRead = {
  readonly bucket: cf.R2Bucket;
  /** Real authenticated owner catalog actor's id.toString(), not a model argument. */
  readonly ownerScope: string;
  readonly chatId: string;
  readonly metadata: AcceptedOriginalMetadata;
  readonly track?: ImageIOTracker;
  readonly signal?: AbortSignal;
};

export type LoadedAcceptedOriginal = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly kind: "image" | "text";
  readonly width: number | null;
  readonly height: number | null;
  readonly textCharacters: number;
};

const integrity = (): never => {
  throw new ImageIOError("original_integrity", "The saved original could not be verified.");
};

/** Retained-only direct R2 read; never a stage-first lookup or authenticated HTTP fetch. */
export const readAcceptedOriginal = async (
  input: AcceptedOriginalRead,
): Promise<LoadedAcceptedOriginal> => {
  const { metadata, bucket, signal } = input;
  checkImageIOSignal(signal);
  const file = Option.getOrNull(Schema.decodeUnknownOption(FileDescriptor)({ ...metadata.file }));
  const scope = input.ownerScope;
  if (
    metadata.state !== "accepted" ||
    metadata.ownerScope !== scope ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(scope) ||
    file === null ||
    file.chatId !== input.chatId ||
    file.state !== "ready" ||
    file.expiresAt !== null
  )
    throw new ImageIOError("invalid_metadata", "Accepted original metadata is unavailable.");
  const key = retainedObjectKey(scope, file.chatId, file.id);
  return runImageIO({
    ...(input.track === undefined ? {} : { track: input.track }),
    signal,
    async run() {
      // R2 get has no AbortSignal; late reads still finish their signal/disposal path.
      const object = await bucket.get(key);
      if (object === null)
        throw new ImageIOError("original_unavailable", "The saved original is unavailable.");
      const body = object.body;
      let reading = false;
      try {
        checkImageIOSignal(signal);
        const declared = object.httpMetadata?.contentType?.split(";")[0]?.trim().toLowerCase();
        const custom = object.customMetadata;
        const range = object.range;
        if (
          object.key !== key ||
          object.size !== file.byteSize ||
          (range !== undefined &&
            (!("offset" in range) ||
              range.offset !== 0 ||
              !("length" in range) ||
              range.length !== file.byteSize)) ||
          (declared !== undefined && declared !== file.mediaType) ||
          (object.httpMetadata?.contentEncoding !== undefined &&
            object.httpMetadata.contentEncoding !== "identity") ||
          (custom?.fileId !== undefined && custom.fileId !== file.id) ||
          (custom?.chatId !== undefined && custom.chatId !== file.chatId)
        )
          integrity();
        reading = true;
        const bytes = await readImageStream(body, file.byteSize, signal);
        const validated = inspectFileBytes(file.name, bytes);
        checkImageIOSignal(signal);
        if (!validated.ok || validated.value.kind === "office") return integrity();
        if (
          validated.value.kind !== file.kind ||
          validated.value.mediaType !== file.mediaType ||
          validated.value.width !== file.width ||
          validated.value.height !== file.height
        )
          integrity();
        return {
          bytes,
          mimeType: validated.value.mediaType,
          kind: validated.value.kind,
          width: validated.value.width,
          height: validated.value.height,
          textCharacters: validated.value.chars,
        };
      } finally {
        if (!reading) await disposeImageStream(body);
      }
    },
  });
};
