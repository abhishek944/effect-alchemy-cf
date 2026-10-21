import type { ImageContent } from "@earendil-works/pi-ai";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "./chat-attachment-schema.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { readImageInfo } from "./chat-files-image.ts";
import { hydrationFailure } from "./chat-image-hydration-types.ts";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Same pure Workers codec shape as the existing private base64Of; no provider logic. */
export const encodeHydrationBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunk)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return btoa(binary);
};

/** Validate/measure legacy data before allocating a decoded buffer. */
export const legacyHydrationByteSize = (block: ImageContent, model: ChatCatalogModel): number => {
  if (!model.imageInput) return hydrationFailure("model_image_unsupported");
  const data = block.data;
  if (
    data.length === 0 ||
    data.length % 4 !== 0 ||
    data.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)
  )
    return hydrationFailure("model_image_limits");
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const end = data.length - padding;
  for (let index = 0; index < end; index++) {
    const code = data.charCodeAt(index);
    if (
      !(
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 43 ||
        code === 47
      )
    )
      return hydrationFailure("original_integrity");
  }
  if (
    (padding === 2 && (alphabet.indexOf(data.at(-3) ?? "") & 15) !== 0) ||
    (padding === 1 && (alphabet.indexOf(data.at(-2) ?? "") & 3) !== 0)
  )
    return hydrationFailure("original_integrity");
  const bytes = (data.length / 4) * 3 - padding;
  if (
    bytes <= 0 ||
    bytes > MAX_IMAGE_BYTES ||
    (model.imageResize !== null && data.length > model.imageResize.maxBytes)
  )
    return hydrationFailure("model_image_limits");
  return bytes;
};

/** Compatibility only; never turn historical inline content into saved-file authority. */
export const checkLegacyHydrationImage = (
  block: ImageContent,
  byteSize: number,
  model: ChatCatalogModel,
): void => {
  const binary = atob(block.data);
  if (binary.length !== byteSize) hydrationFailure("original_integrity");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const info = readImageInfo(bytes);
  if (
    !info.ok ||
    info.animated ||
    info.width <= 0 ||
    info.height <= 0 ||
    info.width * info.height > MAX_IMAGE_PIXELS ||
    `image/${info.format}` !== block.mimeType
  )
    return hydrationFailure("original_integrity");
  const limits = model.imageResize;
  if (limits !== null && (info.width > limits.maxWidth || info.height > limits.maxHeight))
    hydrationFailure("model_image_limits");
};
