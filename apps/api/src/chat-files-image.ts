/** Actual JPEG/PNG/WebP structure parsing; declared MIME types are never trusted. */
export type ImageFormat = "jpeg" | "png" | "webp";

export type ImageInfo =
  | {
      readonly ok: true;
      readonly format: ImageFormat;
      readonly width: number;
      readonly height: number;
      readonly animated: boolean;
    }
  | { readonly ok: false };

const invalid: ImageInfo = { ok: false };

const ascii = (bytes: Uint8Array, offset: number, length: number): string | null => {
  if (offset + length > bytes.length) return null;
  let value = "";
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index] ?? 0);
  }
  return value;
};

const sof = (code: number): boolean =>
  (code >= 0xc0 && code <= 0xc3) ||
  (code >= 0xc5 && code <= 0xc7) ||
  (code >= 0xc9 && code <= 0xcb) ||
  (code >= 0xcd && code <= 0xcf);

/** Baseline and progressive JPEG dimensions from the first frame header. */
const jpegInfo = (bytes: Uint8Array, view: DataView): ImageInfo => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return invalid;
  let offset = 2;
  let segments = 0;
  while (offset + 1 < bytes.length && segments < 512) {
    segments += 1;
    if (view.getUint8(offset) !== 0xff) return invalid;
    let code = view.getUint8(offset + 1);
    offset += 2;
    while (code === 0xff) {
      if (offset >= bytes.length) return invalid;
      code = view.getUint8(offset);
      offset += 1;
    }
    if (code === 0xd8 || (code >= 0xd0 && code <= 0xd7) || code === 0x01) continue;
    if (code === 0xd9) return invalid;
    if (offset + 2 > bytes.length) return invalid;
    const length = view.getUint16(offset, false);
    if (length < 2 || offset + length > bytes.length) return invalid;
    if (sof(code)) {
      if (length < 7) return invalid;
      return {
        ok: true,
        format: "jpeg",
        height: view.getUint16(offset + 3, false),
        width: view.getUint16(offset + 5, false),
        animated: false,
      };
    }
    if (code === 0xda) return invalid;
    offset += length;
  }
  return invalid;
};

/** IHDR dimensions; `acTL` before `IDAT` marks an animated PNG. */
const pngInfo = (bytes: Uint8Array, view: DataView): ImageInfo => {
  if (bytes.length < 33 || bytes[0] !== 0x89) return invalid;
  if (ascii(bytes, 1, 3) !== "PNG") return invalid;
  if (bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a)
    return invalid;
  if (view.getUint32(8, false) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return invalid;
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  let offset = 8;
  let animated = false;
  let chunks = 0;
  while (offset + 12 <= bytes.length && chunks < 128) {
    chunks += 1;
    const length = view.getUint32(offset, false);
    const type = ascii(bytes, offset + 4, 4);
    if (type === null || offset + 12 + length > bytes.length) break;
    if (type === "acTL") animated = true;
    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + length;
  }
  return { ok: true, format: "png", width, height, animated };
};

/** RIFF/WebP variants: extended VP8X, lossy VP8, lossless VP8L. */
const webpInfo = (bytes: Uint8Array, view: DataView): ImageInfo => {
  if (bytes.length < 30) return invalid;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return invalid;
  const fourcc = ascii(bytes, 12, 4);
  const chunkSize = view.getUint32(16, true);
  if (fourcc === "VP8X") {
    if (chunkSize < 10) return invalid;
    const flags = view.getUint8(20);
    const width = (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16)) + 1;
    const height = (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16)) + 1;
    return { ok: true, format: "webp", width, height, animated: (flags & 0x02) !== 0 };
  }
  if (fourcc === "VP8 ") {
    if (view.getUint8(23) !== 0x9d || view.getUint8(24) !== 0x01 || view.getUint8(25) !== 0x2a)
      return invalid;
    return {
      ok: true,
      format: "webp",
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
      animated: false,
    };
  }
  if (fourcc === "VP8L") {
    if (view.getUint8(20) !== 0x2f) return invalid;
    const bits = view.getUint32(21, true);
    return {
      ok: true,
      format: "webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      animated: false,
    };
  }
  return invalid;
};

/** Reads actual format and pixel dimensions, or reports invalid bytes. */
export const readImageInfo = (bytes: Uint8Array): ImageInfo => {
  if (bytes.length < 8) return invalid;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegInfo(bytes, view);
  if (bytes[0] === 0x89) return pngInfo(bytes, view);
  if (ascii(bytes, 0, 4) === "RIFF") return webpInfo(bytes, view);
  return invalid;
};
