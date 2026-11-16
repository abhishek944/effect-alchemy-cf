import type { FileDescriptor } from "./chat-attachment-schema.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { filesFail, filesOk, type ChatFilesResult } from "./chat-files-model.ts";

type ImageLimitMetadata = Pick<FileDescriptor, "kind">;

/** Same byte-free policy for active accepted originals, staged inputs and saved references. */
export const chatFilesImageCompatibility = (
  files: readonly ImageLimitMetadata[],
  model: ChatCatalogModel,
): ChatFilesResult<null> => {
  const images = files.filter((file) => file.kind === "image");
  if (images.length > 0 && !model.imageInput) return filesFail("model_image_unsupported");
  // The SDK's images.resize metadata is an optional cache-safe preparation
  // profile, not a mandatory original/provider limit. Integrity and actual
  // request-context validation remain at their owning boundaries.
  return filesOk(null);
};
