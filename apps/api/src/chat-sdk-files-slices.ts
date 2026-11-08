/**
 * Exact selected-text validation for saved references.
 *
 * Runs only after the catalog has resolved owner/chat-scoped immutable metadata.
 * A missing original or an out-of-range UTF-16 span refuses the whole send; it
 * never falls back to whole-file hydration or to newer file text.
 */
import type * as cf from "./platform.ts";
import type { ChatReferenceInputs } from "@highchat/chat-contract";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import { decodeTextFile } from "./chat-files-text.ts";
import { ChatSdkFilesError } from "./chat-sdk-files-types.ts";
import { readAcceptedOriginal } from "./chat-image-original.ts";
import { referenceTextSlice } from "./chat-reference-input.ts";

export type ReferenceSliceInput = {
  readonly bucket: cf.R2Bucket;
  /** Actual owner catalog object scope. */
  readonly ownerScope: string;
  readonly chatId: string;
  readonly references: ChatReferenceInputs;
  readonly files: readonly FileDescriptor[];
  readonly signal?: AbortSignal | undefined;
};

export const validateReferenceSlices = async (input: ReferenceSliceInput): Promise<void> => {
  const ids = new Set(
    input.references.flatMap((ref) =>
      ref.kind === "original" && ref.text !== undefined ? [ref.fileId] : [],
    ),
  );
  for (const fileId of ids) {
    input.signal?.throwIfAborted();
    const file = input.files.find((item) => item.id === fileId);
    if (file === undefined || file.kind !== "text") throw new ChatSdkFilesError("invalid_input");
    const loaded = await readAcceptedOriginal({
      bucket: input.bucket,
      ownerScope: input.ownerScope,
      chatId: input.chatId,
      metadata: { state: "accepted", ownerScope: input.ownerScope, file },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    input.signal?.throwIfAborted();
    const decoded = decodeTextFile(loaded.bytes, 0);
    if (!decoded.ok) throw new ChatSdkFilesError("unavailable");
    for (const ref of input.references) {
      if (ref.kind !== "original" || ref.fileId !== fileId || ref.text === undefined) continue;
      try {
        referenceTextSlice(decoded.text, ref.text);
      } catch {
        throw new ChatSdkFilesError("invalid_input");
      }
    }
  }
};
