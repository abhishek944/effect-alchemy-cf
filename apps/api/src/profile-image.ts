/**
 * Structural completeness check for a private avatar.
 *
 * `readImageInfo` parses format, dimensions and animation from bytes;
 * `validateFileBytes` checks the shared allowlist and media-type agreement.
 * `profile-upload.ts` owns the stricter avatar byte and format-specific pixel
 * limits. This helper checks container completeness, not decoded pixel validity.
 * The upload route separately requires server pixel decoding before staging.
 */
import type { AvatarMediaType } from "./profile-model.ts";

const EOI = 0xd9;
const SOS = 0xda;

const ascii = (bytes: Uint8Array, offset: number, length: number): string | null => {
  if (offset + length > bytes.length) return null;
  let value = "";
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index] ?? 0);
  }
  return value;
};

/** JPEG: SOI, a consistent segment walk to the first scan, and a final EOI marker. */
const jpegComplete = (bytes: Uint8Array): boolean => {
  const length = bytes.length;
  if (length < 8 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  if (bytes[length - 2] !== 0xff || bytes[length - 1] !== EOI) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  for (let segments = 0; segments < 4096; segments += 1) {
    if (offset + 1 >= length) return false;
    if (view.getUint8(offset) !== 0xff) return false;
    let code = view.getUint8(offset + 1);
    offset += 2;
    while (code === 0xff) {
      if (offset >= length) return false;
      code = view.getUint8(offset);
      offset += 1;
    }
    if (code === 0xd8 || (code >= 0xd0 && code <= 0xd7) || code === 0x01) continue;
    if (code === EOI) return false;
    if (offset + 2 > length) return false;
    const size = view.getUint16(offset, false);
    if (size < 2 || offset + size > length) return false;
    if (code === SOS) return true;
    offset += size;
  }
  return false;
};

/** PNG: every chunk bounded inside the file and a final zero-length IEND. */
const pngComplete = (bytes: Uint8Array): boolean => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.length;
  let offset = 8;
  let sawIDAT = false;
  for (let chunks = 0; chunks < 4096; chunks += 1) {
    if (offset + 12 > length) return false;
    const size = view.getUint32(offset, false);
    if (size > 0x7fffffff) return false;
    const type = ascii(bytes, offset + 4, 4);
    if (type === null || offset + 12 + size > length) return false;
    if (type === "IDAT") sawIDAT = true;
    if (type === "IEND") return size === 0 && offset + 12 === length && sawIDAT;
    offset += 12 + size;
  }
  return false;
};

/** WebP: RIFF size must match the file and the chunk walk must land exactly at the end. */
const webpComplete = (bytes: Uint8Array): boolean => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.length;
  if (length < 20) return false;
  if (view.getUint32(4, true) + 8 !== length) return false;
  let offset = 12;
  let chunks = 0;
  while (offset + 8 <= length) {
    chunks += 1;
    if (chunks > 4096) return false;
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > length) return false;
    offset = end;
  }
  return offset === length && chunks > 0;
};

/** True only when the container is complete enough that truncation is excluded. */
export const completeImageStructure = (mediaType: AvatarMediaType, bytes: Uint8Array): boolean => {
  if (mediaType === "image/jpeg") return jpegComplete(bytes);
  if (mediaType === "image/png") return pngComplete(bytes);
  return webpComplete(bytes);
};
