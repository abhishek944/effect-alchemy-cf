/**
 * Bounded real PNG pixel-stream decode.
 *
 * Every chunk is length-bounded and CRC-checked, the concatenated IDAT stream is
 * really inflated with the platform `DecompressionStream`, and each scanline is
 * indexed rows unfiltered and checked against the palette. Nonindexed sample
 * bit patterns are all valid and filters invertible: stream/count them without
 * allocating giant RGBA scanlines. Indexed row storage is at most 32 MiB. The stream must produce exactly the filtered byte count implied by
 * the header geometry and then end; a truncated, corrupt or empty image payload
 * is rejected instead of being accepted as a "complete container".
 */
import { parseChunks, type PngGeometry } from "./profile-decode-png-chunks.ts";

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

const paeth = (left: number, up: number, upLeft: number): number => {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  return dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
};

/** In-place unfilter of one scanline; `row[0]` is the filter byte. */
const unfilter = (
  row: Uint8Array,
  previous: Uint8Array,
  bpp: number,
  rowBytes: number,
): boolean => {
  const type = row[0] ?? 5;
  if (type > 4) return false;
  for (let index = 0; index < rowBytes; index += 1) {
    const at = index + 1;
    const raw = row[at] ?? 0;
    const left = index >= bpp ? (row[at - bpp] ?? 0) : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= bpp ? (previous[index - bpp] ?? 0) : 0;
    const value =
      type === 0
        ? raw
        : type === 1
          ? raw + left
          : type === 2
            ? raw + up
            : type === 3
              ? raw + ((left + up) >> 1)
              : raw + paeth(left, up, upLeft);
    row[at] = value & 0xff;
  }
  return true;
};

/** Real bounded decode of the PNG pixel stream; null when it cannot decode. */
export const decodePng = async (bytes: Uint8Array): Promise<PngGeometry | null> => {
  const parsed = parseChunks(bytes);
  if (parsed === null) return null;
  const { header, idat, paletteEntries } = parsed;
  const indexed = header.colour === 3;
  const bpp = Math.max(1, Math.ceil(header.bitsPerPixel / 8));
  const passes = header.interlace === 1 ? ADAM7 : ([[0, 0, 1, 1]] as const);
  const maxRowBytes = indexed ? Math.ceil((header.width * header.bitsPerPixel) / 8) : 0;
  const row = new Uint8Array(maxRowBytes + 1);
  const previous = new Uint8Array(maxRowBytes);
  let source: Uint8Array = new Uint8Array(0);
  let sourceOffset = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    let partIndex = 0;
    let partOffset = 0;
    // Bound each compressed chunk: one Blob chunk could inflate to tens of MiB
    // before the consumer can reject extra pixels or apply backpressure.
    const compressed = new ReadableStream<Uint8Array>({
      pull(controller) {
        while (partIndex < idat.length) {
          const part = idat[partIndex];
          if (part === undefined || partOffset === part.length) {
            partIndex += 1;
            partOffset = 0;
            continue;
          }
          const end = Math.min(part.length, partOffset + 1024);
          controller.enqueue(part.subarray(partOffset, end));
          partOffset = end;
          return;
        }
        controller.close();
      },
    });
    reader = compressed.pipeThrough(new DecompressionStream("deflate")).getReader();
  } catch {
    return null;
  }
  const refill = async (): Promise<boolean> => {
    if (sourceOffset < source.length) return true;
    const next = await reader.read();
    if (next.done || next.value === undefined) return false;
    source = next.value;
    sourceOffset = 0;
    return true;
  };
  const take = async (count: number, collect = true): Promise<boolean> => {
    let written = 0;
    while (written < count) {
      if (!(await refill())) return false;
      const size = Math.min(source.length - sourceOffset, count - written);
      if (collect) row.set(source.subarray(sourceOffset, sourceOffset + size), written);
      sourceOffset += size;
      written += size;
    }
    return true;
  };
  try {
    for (const pass of passes) {
      const [xStart, yStart, xStep, yStep] = pass;
      const passWidth = Math.ceil((header.width - xStart) / xStep);
      const passHeight = Math.ceil((header.height - yStart) / yStep);
      if (passWidth <= 0 || passHeight <= 0) continue;
      const rowBytes = Math.ceil((passWidth * header.bitsPerPixel) / 8);
      previous.fill(0, 0, rowBytes);
      for (let line = 0; line < passHeight; line += 1) {
        if (!indexed) {
          if (!(await take(1)) || (row[0] ?? 5) > 4) return null;
          if (!(await take(rowBytes, false))) return null;
          continue;
        }
        if (!(await take(rowBytes + 1))) return null;
        if (!unfilter(row, previous, bpp, rowBytes)) return null;
        if (paletteEntries < 2 ** header.depth) {
          const mask = (1 << header.depth) - 1;
          for (let pixel = 0; pixel < passWidth; pixel += 1) {
            const bit = pixel * header.depth;
            const index =
              ((row[1 + Math.floor(bit / 8)] ?? 0) >> (8 - header.depth - (bit % 8))) & mask;
            if (index >= paletteEntries) return null;
          }
        }
        previous.set(row.subarray(1, rowBytes + 1), 0);
      }
    }
    if (sourceOffset < source.length) return null;
    const leftover = await reader.read();
    if (!leftover.done) return null;
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { width: header.width, height: header.height };
};
