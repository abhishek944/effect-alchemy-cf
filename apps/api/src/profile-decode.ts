/**
 * Local pixel-decode validation. Keep the Worker-only WebP module lazy so stack
 * composition can import the ordinary API graph in Node without loading Wasm.
 */
import { decode as decodeJpeg } from "jpeg-js";
import { decodePng } from "./profile-decode-png.ts";
import { AVATAR_MAX_PIXELS, type AvatarMediaType } from "./profile-model.ts";

export type DecodedImage = { readonly width: number; readonly height: number };
const MAX_JPEG_MEMORY_MB = 64;

const decodeJpegBytes = (bytes: Uint8Array): DecodedImage | null => {
  try {
    const image = decodeJpeg(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: AVATAR_MAX_PIXELS / 1_000_000,
      maxMemoryUsageInMB: MAX_JPEG_MEMORY_MB,
    });
    const { width, height } = image;
    if (width <= 0 || height <= 0 || width * height > AVATAR_MAX_PIXELS) return null;
    return image.data.length === width * height * 4 ? { width, height } : null;
  } catch {
    return null;
  }
};

export const decodeAvatarImage = async (
  mediaType: AvatarMediaType,
  bytes: Uint8Array,
): Promise<DecodedImage | null> => {
  if (mediaType === "image/png") return await decodePng(bytes);
  if (mediaType === "image/jpeg") return decodeJpegBytes(bytes);
  const { decodeWebpBytes } = await import("./profile-decode-webp.ts");
  return await decodeWebpBytes(bytes);
};
