import type { ChatCatalogEntry } from "@/lib/chat-capability-types";

type InputFile = {
  id: string;
  name: string;
  kind: "image" | "text" | "office";
  byteSize: number;
  width: number | null;
  height: number | null;
};

/** Upload/reference identity and selected-model compatibility, not product capacity. */
export function inputFilesReason(
  files: readonly InputFile[],
  model: ChatCatalogEntry | null,
): string | null {
  if (new Set(files.map((file) => file.id)).size !== files.length)
    return "The same file cannot be both a staged upload and a saved reference.";
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
