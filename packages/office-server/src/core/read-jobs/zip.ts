import { crc32 } from "node:zlib";

/** Small ordinary stored ZIP: server-generated PNG names, <=32 entries, no ZIP64 needed. */
export function imageZip(images: readonly Uint8Array[]): Uint8Array {
  const encoder = new TextEncoder();
  const names = images.map((_, index) => encoder.encode("page-" + String(index + 1) + ".png"));
  const size = images.reduce(
    (total, image, index) => total + image.byteLength + 76 + 2 * (names[index]?.byteLength ?? 0),
    22,
  );
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  const entries: { offset: number; size: number; crc: number; name: Uint8Array }[] = [];
  let position = 0;
  for (const [index, image] of images.entries()) {
    const name = names[index];
    if (name === undefined) throw new RangeError("ZIP entry identity missing.");
    const crc = crc32(image),
      offset = position;
    view.setUint32(position, 0x04034b50, true);
    view.setUint16(position + 4, 20, true);
    view.setUint16(position + 12, 33, true); // Deterministic 1980-01-01 DOS date.
    view.setUint32(position + 14, crc, true);
    view.setUint32(position + 18, image.byteLength, true);
    view.setUint32(position + 22, image.byteLength, true);
    view.setUint16(position + 26, name.byteLength, true);
    bytes.set(name, position + 30);
    bytes.set(image, position + 30 + name.byteLength);
    position += 30 + name.byteLength + image.byteLength;
    entries.push({ offset, size: image.byteLength, crc, name });
  }
  const directory = position;
  for (const entry of entries) {
    view.setUint32(position, 0x02014b50, true);
    view.setUint16(position + 4, 20, true);
    view.setUint16(position + 6, 20, true);
    view.setUint16(position + 14, 33, true);
    view.setUint32(position + 16, entry.crc, true);
    view.setUint32(position + 20, entry.size, true);
    view.setUint32(position + 24, entry.size, true);
    view.setUint16(position + 28, entry.name.byteLength, true);
    view.setUint32(position + 42, entry.offset, true);
    bytes.set(entry.name, position + 46);
    position += 46 + entry.name.byteLength;
  }
  view.setUint32(position, 0x06054b50, true);
  view.setUint16(position + 8, entries.length, true);
  view.setUint16(position + 10, entries.length, true);
  view.setUint32(position + 12, position - directory, true);
  view.setUint32(position + 16, directory, true);
  return bytes;
}
