/**
 * Bounded PNG chunk layer: signature, length-bounded CRC-checked chunk walk and
 * header validation. Kept separate from the pixel-stream decoder so both stay
 * small and independently reviewable.
 */
import { AVATAR_MAX_PIXELS } from "./profile-model.ts";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const KNOWN_CRITICAL = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let value = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    value = (CRC_TABLE[(value ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const u32 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) * 0x1000000 +
  ((bytes[at + 1] ?? 0) << 16) +
  ((bytes[at + 2] ?? 0) << 8) +
  (bytes[at + 3] ?? 0);

const chunkType = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);

export type PngGeometry = { readonly width: number; readonly height: number };

type PngHeader = PngGeometry & {
  readonly bitsPerPixel: number;
  readonly interlace: number;
  readonly colour: number;
  readonly depth: number;
};

const VALID_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

const parseHeader = (bytes: Uint8Array): PngHeader | null => {
  if (bytes.length < 33) return null;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  const depth = bytes[24] ?? 0;
  const colour = bytes[25] ?? 0;
  const compression = bytes[26] ?? 1;
  const filter = bytes[27] ?? 1;
  const interlace = bytes[28] ?? 2;
  const depths = VALID_DEPTHS[colour];
  if (depths === undefined || !depths.includes(depth)) return null;
  if (compression !== 0 || filter !== 0 || interlace > 1) return null;
  if (width <= 0 || height <= 0 || width * height > AVATAR_MAX_PIXELS) return null;
  const channels = colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 1;
  return { width, height, bitsPerPixel: channels * depth, interlace, colour, depth };
};

/** Bounded chunk walk; returns the IDAT payload and header or null. */
export const parseChunks = (
  bytes: Uint8Array,
): { header: PngHeader; idat: Uint8Array[]; paletteEntries: number } | null => {
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (bytes[index] !== SIGNATURE[index]) return null;
  }
  let offset = 8;
  let header: PngHeader | null = null;
  const idat: Uint8Array[] = [];
  let sawEnd = false;
  let paletteEntries = 0;
  let idatClosed = false;
  let transparency = false;
  while (offset + 12 <= bytes.length) {
    const length = u32(bytes, offset);
    const type = chunkType(bytes, offset + 4);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2]?.toUpperCase()) return null;
    if (type === "acTL" || type === "fcTL" || type === "fdAT") return null;
    if (idat.length > 0 && type !== "IDAT") idatClosed = true;
    if (length > 0x7fffffff || offset + 12 + length > bytes.length) return null;
    if (crc32(bytes, offset + 4, offset + 8 + length) !== u32(bytes, offset + 8 + length))
      return null;
    if (header === null && (type !== "IHDR" || offset !== 8)) return null;
    if (header === null) {
      // The header always sits inside the first chunk, so its bytes are bounded by the chunk length.
      if (length !== 13) return null;
      header = parseHeader(bytes);
      if (header === null) return null;
    } else if (type === "IHDR") {
      return null;
    } else if (type === "PLTE") {
      if (paletteEntries !== 0 || idat.length > 0 || header.colour === 0 || header.colour === 4)
        return null;
      if (length === 0 || length % 3 !== 0 || length > 768) return null;
      paletteEntries = length / 3;
      if (header.colour === 3 && paletteEntries > 2 ** header.depth) return null;
    } else if (type === "tRNS") {
      if (transparency || idat.length > 0) return null;
      if (
        header.colour === 3
          ? paletteEntries === 0 || length === 0 || length > paletteEntries
          : header.colour === 0
            ? length !== 2
            : header.colour === 2
              ? length !== 6
              : true
      )
        return null;
      transparency = true;
    } else if (type === "IDAT") {
      if (idatClosed || (header.colour === 3 && paletteEntries === 0)) return null;
      idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    } else if (type === "IEND") {
      if (length !== 0 || offset + 12 !== bytes.length) return null;
      sawEnd = true;
      break;
    } else if (type[0] === type[0]?.toUpperCase() && !KNOWN_CRITICAL.has(type)) {
      return null;
    }
    offset += 12 + length;
  }
  if (header === null || !sawEnd || idat.length === 0) return null;
  return { header, idat, paletteEntries };
};
