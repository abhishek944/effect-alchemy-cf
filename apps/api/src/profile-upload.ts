/**
 * Untrusted avatar upload validation.
 *
 * The filename only selects the allowlisted decoder; the bytes decide the real
 * format and must decode within 5 MiB and the common 2 MP pixel ceiling, so a
 * container-shaped file with no decodable pixel payload is refused before any
 * object is reserved or written. JPEG and WebP use pinned pure decoders
 * (jpeg-js and statically instantiated jSquash WebP) and PNG uses the in-repo bounded
 * pixel-stream decoder; every path fails closed.
 */
import { readBoundedBody } from "./body-limit.ts";
import { validateFileBytes } from "./chat-files-media.ts";
import { decodeAvatarImage } from "./profile-decode.ts";
import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_PIXELS,
  AVATAR_MEDIA_TYPES,
  WEBP_MAX_DECODED_BYTES,
  type AvatarMediaType,
} from "./profile-model.ts";

export type DecodedAvatar = {
  readonly bytes: Uint8Array;
  readonly mediaType: AvatarMediaType;
  readonly width: number;
  readonly height: number;
  readonly digest: string;
  readonly byteSize: number;
};

export type DecodeResult =
  | { readonly ok: true; readonly value: DecodedAvatar }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly status: number;
    };

const refuse = (code: string, message: string, status: number): DecodeResult => ({
  ok: false,
  code,
  message,
  status,
});

const uploadName = (web: Request): string | null => {
  const raw = web.headers.get("x-file-name");
  if (raw === null) return null;
  try {
    const name = decodeURIComponent(raw);
    return name.length === 0 ? null : name;
  } catch {
    return null;
  }
};

export const decodeAvatar = async (web: Request): Promise<DecodeResult> => {
  const name = uploadName(web);
  if (name === null) return refuse("invalid_input", "Choose an image file.", 400);
  const bytes = await readBoundedBody(web, AVATAR_MAX_BYTES);
  if (bytes === null) return refuse("file_too_large", "Choose an image up to 5 MiB.", 413);
  if (bytes.byteLength === 0) return refuse("invalid_content", "That image is empty.", 422);
  const validated = await validateFileBytes(name, bytes);
  if (!validated.ok)
    return validated.code === "file_too_large"
      ? refuse("file_too_large", "Choose an image up to 5 MiB and 2 MP.", 413)
      : refuse("unsupported_type", "Use a JPEG, PNG or WebP image.", 415);
  const value = validated.value;
  const mediaType = AVATAR_MEDIA_TYPES.find((type) => type === value.mediaType);
  if (value.kind !== "image" || mediaType === undefined)
    return refuse("unsupported_type", "Use a JPEG, PNG or WebP image.", 415);
  if (
    value.width === null ||
    value.height === null ||
    value.width * value.height > AVATAR_MAX_PIXELS
  )
    return refuse("file_too_large", "Choose an image up to 2 MP.", 413);
  if (mediaType === "image/webp" && value.width * value.height * 4 > WEBP_MAX_DECODED_BYTES)
    return refuse(
      "file_too_large",
      "This WebP needs too much decoding memory. Choose a smaller image.",
      413,
    );
  const decoded = await decodeAvatarImage(mediaType, bytes);
  if (decoded === null)
    return refuse(
      "invalid_content",
      "That image file could not be decoded and was not saved.",
      422,
    );
  if (decoded.width !== value.width || decoded.height !== value.height)
    return refuse("invalid_content", "That image file is inconsistent and was not saved.", 422);
  return {
    ok: true,
    value: {
      bytes,
      mediaType,
      width: decoded.width,
      height: decoded.height,
      digest: value.digest,
      byteSize: bytes.byteLength,
    },
  };
};
