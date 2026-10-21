import { Schema } from "effect";
import { DomainUuid } from "./chat-capabilities.ts";
import { decodeOption } from "./chat-internal.ts";
import { ImageDigest, ImageStorageError } from "./chat-image-storage-schema.ts";

const Cursor = Schema.Struct({
  query: ImageDigest,
  id: DomainUuid,
  time: Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n > 0)),
  name: Schema.String.check(Schema.isMaxLength(255)),
});
export type LibraryCursor = typeof Cursor.Type;
export const encodeLibraryCursor = (value: LibraryCursor): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const encoded = btoa(Array.from(bytes, (n) => String.fromCharCode(n)).join(""));
  if (encoded.length > 2048) throw new ImageStorageError("unavailable");
  return encoded;
};
export const decodeLibraryCursor = (value: string, query: string): LibraryCursor => {
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    const decoded = decodeOption(
      Cursor,
      JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
    );
    if (decoded !== null && decoded.query === query) return decoded;
  } catch {
    // Invalid cursors never restart at page one silently.
  }
  throw new ImageStorageError("invalid_input");
};
