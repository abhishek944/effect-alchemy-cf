import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  type FileDescriptor,
} from "./chat-attachment-schema.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import {
  filesFail,
  filesOk,
  type ChatFilesFailure,
  type ChatFilesResult,
} from "./chat-files-model.ts";

type ImageLimitMetadata = Pick<FileDescriptor, "kind" | "byteSize" | "width" | "height">;
/** Installed imageResize.maxBytes is the encoded input ceiling, not original bytes. */
export const imageBase64Bytes = (raw: number): number => 4 * Math.ceil(raw / 3);

const imageFailure = (
  file: ImageLimitMetadata,
  model: ChatCatalogModel,
): ChatFilesFailure | null => {
  if (file.byteSize > MAX_IMAGE_BYTES) return "file_too_large";
  if ((file.width ?? 0) * (file.height ?? 0) > MAX_IMAGE_PIXELS) return "file_too_large";
  const resize = model.imageResize;
  if (resize === null) return null;
  if ((file.width ?? 0) > resize.maxWidth || (file.height ?? 0) > resize.maxHeight)
    return "model_image_limits";
  return imageBase64Bytes(file.byteSize) > resize.maxBytes ? "model_image_limits" : null;
};

/** Same byte-free policy for active accepted originals, staged inputs and saved references. */
export const chatFilesImageCompatibility = (
  files: readonly ImageLimitMetadata[],
  model: ChatCatalogModel,
): ChatFilesResult<null> => {
  const images = files.filter((file) => file.kind === "image");
  if (images.length > 0 && !model.imageInput) return filesFail("model_image_unsupported");
  for (const file of images) {
    const failure = imageFailure(file, model);
    if (failure !== null) return filesFail(failure);
  }
  return filesOk(null);
};
