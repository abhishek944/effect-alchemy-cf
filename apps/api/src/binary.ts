/**
 * Web `BodyInit`/`BlobPart`/`BufferSource` reject a possibly-shared buffer, while
 * every value here is a freshly allocated owned array. One narrow cast keeps the
 * call sites honest instead of asserting at each of them.
 */

// Each helper narrows an owned byte array to the Web request/response type it
// is passed to; the value itself is never inspected or reinterpreted.
export const bodyInit = (bytes: Uint8Array): BodyInit =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- owned bytes
  bytes as unknown as BodyInit;

export const blobPart = (bytes: Uint8Array): BlobPart =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- owned bytes
  bytes as unknown as BlobPart;

export const bufferSource = (bytes: Uint8Array): BufferSource =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- owned bytes
  bytes as unknown as BufferSource;
