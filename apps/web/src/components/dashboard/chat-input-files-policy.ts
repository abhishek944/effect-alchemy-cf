import type { ChatCatalogEntry } from "@/lib/chat-capability-types";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_ATTACHMENT_BYTES,
} from "@/lib/chat-capability-file-types";
import { formatFileSize } from "@/lib/chat-file-local";

type InputFile = {
  id: string;
  name: string;
  kind: "image" | "text" | "office";
  byteSize: number;
  width: number | null;
  height: number | null;
};

/** Existing input-file limits apply to uploads plus saved references, not tool outputs. */
export function inputFilesReason(
  files: readonly InputFile[],
  model: ChatCatalogEntry | null,
): string | null {
  if (new Set(files.map((file) => file.id)).size !== files.length)
    return "The same file cannot be both a staged upload and a saved reference.";
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE)
    return `At most ${MAX_ATTACHMENTS_PER_MESSAGE} files can be sent in one message, including saved references.`;
  if (files.reduce((sum, file) => sum + file.byteSize, 0) > MAX_MESSAGE_ATTACHMENT_BYTES)
    return `Files for one message, including saved references, can total at most ${formatFileSize(MAX_MESSAGE_ATTACHMENT_BYTES)}.`;
  if (!model) return null;
  for (const file of files) {
    if (file.kind !== "image") continue;
    if (!model.imageInput)
      return `${model.name} cannot read images. Choose an image-capable model or remove "${file.name}".`;
    const limit = model.imageResize;
    // The installed model limit counts base64 payload bytes, not retained original bytes.
    if (
      limit &&
      (4 * Math.ceil(file.byteSize / 3) > limit.maxBytes ||
        (file.width ?? 0) > limit.maxWidth ||
        (file.height ?? 0) > limit.maxHeight)
    )
      return `"${file.name}" exceeds ${model.name}'s original-image limits. Choose another model or remove it; originals are not resized.`;
  }
  return null;
}
