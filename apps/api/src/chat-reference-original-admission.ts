import type { ChatReferenceInputs } from "@starter/office-contract";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import type { ChatCatalogStub } from "./chat-bindings.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import { decodeTextFile } from "./chat-files-text.ts";
import { readAcceptedOriginal } from "./chat-image-original.ts";
import { ImageInputError } from "./chat-image-input-types.ts";
import { referenceTextSlice } from "./chat-reference-input.ts";

/** Only after prepareImageInputFiles has resolved owner/chat-scoped saved-original metadata. */
export async function validateOriginalReferenceSlices(
  env: ConversationFileEnv,
  catalog: ChatCatalogStub,
  chatId: string,
  references: ChatReferenceInputs,
  files: readonly FileDescriptor[],
  signal?: AbortSignal,
): Promise<void> {
  for (const fileId of new Set(
    references.flatMap((ref) =>
      ref.kind === "original" && ref.text !== undefined ? [ref.fileId] : [],
    ),
  )) {
    const file = files.find((item) => item.id === fileId);
    if (file === undefined || file.kind !== "text") throw new ImageInputError("invalid_input");
    if (env.CHAT_FILES === undefined) throw new ImageInputError("unavailable");
    const ownerScope = catalog.id.toString();
    const loaded = await readAcceptedOriginal({
      bucket: env.CHAT_FILES,
      ownerScope,
      chatId,
      metadata: { state: "accepted", ownerScope, file },
      ...(signal === undefined ? {} : { signal }),
    });
    const decoded = decodeTextFile(loaded.bytes, 0);
    if (!decoded.ok) throw new ImageInputError("unavailable");
    for (const ref of references) {
      if (ref.kind === "original" && ref.fileId === fileId && ref.text !== undefined)
        referenceTextSlice(decoded.text, ref.text);
    }
  }
}
