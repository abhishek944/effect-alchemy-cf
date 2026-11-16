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
    // imageResize is an optional SDK cache-safe preparation profile, not a
    // provider admission limit. Do not reject valid originals against it.
  }
  return null;
}
